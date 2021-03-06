const bufferpack = require("bufferpack");

const limits = require("./limits");

exports.types = {};
exports.typeIds = {};

//* @see MAXNICKSIZE in lsTypes.h
exports.MAX_NICK_SIZE = 40;

function Type(name, format, defaultValue) {
	this.name = name;
	this.format = format;
	this.defaultValue = defaultValue;
	this.length = bufferpack.calcLength("<" + format);
}

function Item(name, type) {
	this.name = name;
	this.type = type;
	if (this.type) this.length = this.type.length;
}
Item.prototype.unpack = function (data, offset, count) {
	offset = offset || 0;
	var format = "<";
	if (this.type instanceof VarType && count > 0) format += count;
	format += this.type.format;
	
	var values = bufferpack.unpack(format, data, offset);
	if (this.type instanceof TypeTuple) {
		if (values.length !== this.type.length) throw "Invalid tuple";
		return values;
	}
	return values && values[0];
};

function VarType(name, format, defaultValue) {
	Type.call(this, name, format, defaultValue);
}
VarType.prototype = new Type;
VarType.prototype.constructor = VarType;

function VarItem(name, type, maxLength) {
	Item.call(this, name, type);
	// lsTypeCStringCreate()
	if (maxLength !== undefined) {
		maxLength++;
		console.assert(maxLength >= 0 && maxLength <= limits.maxInt);
	}
	this.maxLength = maxLength;
	this.countLength = Math.ceil(Math.log(maxLength) / Math.log(limits.maxUChar + 1));
}
VarItem.prototype = new Item;
VarItem.prototype.constructor = VarItem;

/**
 * @see lcTypeIntCreate in lcTypeInt.c
 */
TypeInt = new Type("long", "l", 0);
function intItem(name) {
	return new Item(name, TypeInt);
}

/**
 * @see lcTypeIntCreate in lcTypeInt.c
 */
TypeByte = new Type("uchar", "b", 0);
function byteItem(name) {
	return new Item(name, TypeByte);
}

/**
 * @see lcTypeRealGet in lcTypeReal.c
 */
TypeReal = new Type("real", "d", 0);
function realItem(name) {
	return new Item(name, TypeReal);
}

/**
 * @see lcTypeArrayCreate in lcTypeArray.c
 */
function TypeTuple(prototypeItem, length) {
	this.prototypeItem = prototypeItem;
	this.length = length;
	this.items = [];
	// If possible, order the items the way we want when the tuple is logged to
	// the console.
	for (var i = 0; i < length; i++) this.items[i] = undefined;
}
TypeTuple.prototype = new Type();
TypeTuple.prototype.constructor = TypeTuple;
Object.defineProperty(TypeTuple.prototype, "format", {
	get: function () {
		var format = "";
		var prototypeType = this.prototypeItem.type;
		for (var i = 0; i < this.length; i++) {
			if (prototypeType instanceof VarType) {
				format += byteItem().type.format + this.items[i].length;
			}
			format += prototypeType.format;
		}
		return format;
	},
});

function tupleItem(elementItem, name, length) {
	var type = new TypeTuple(elementItem, length);
	return new Item(name, type);
}

function ArrayItem(name, type, countItemName) {
	VarItem.call(this, name, type);
	this.countItemName = countItemName;
}
ArrayItem.prototype = new VarItem;
ArrayItem.prototype.constructor = ArrayItem;
ArrayItem.prototype.unpack = function (data, offset, count) {
	offset = offset || 0;
	var format = "<" + count + this.type.format;
	
	var values = bufferpack.unpack(format, data, offset);
	if (values.length !== count) throw "Incorrect number of items in array";
	return values;
};
function arrayItem(type, name, countItemName) {
	return new ArrayItem(name, type, countItemName);
}

/**
 * @see lcTypeCStringCreate in lcTypeCString.c
 */
TypeString = new VarType("cstring", "s", null);
function stringItem(name, maxLength) {
	return new VarItem(name, TypeString, maxLength);
}

/**
 * @see lcTypeStructStruct in lcTypeStruct.c
 */
function TypeStruct(data, moreData) {
	// If possible, order the items the way we want when the struct is logged
	// to the console.
	this.constructor.items.forEach(function (item, idx, items) {
		if (item.name) this[item.name] = data ? data[item.name] : undefined;
	}, this);
	
	for (var name in moreData) this[name] = moreData[name];
}
//TypeStruct.prototype = new Type();
TypeStruct.items = [];
TypeStruct.prototype.unpack = function (data, offset) {
	offset = offset || 0;
	for (var i = 0; i < this.constructor.items.length; i++) {
		var item = this.constructor.items[i];
		var length = item.type.length;
		var count = 1;
		if (item.type instanceof VarType) {
			var countItem = arrayItem(TypeByte, "count");
			var countValues = countItem.unpack(data, offset, item.countLength);
			if (!countValues.length) throw "Invalid variable-length item";
			count = countValues[0];
			offset += item.countLength;
			if (count < 0) continue;	// NULL
		}
		if (item instanceof ArrayItem) {
			console.assert(item.countItemName in this,
						   item.name + " depends on nonexistent count item " +
						   item.countItemName);
			count = this[item.countItemName];
		}
		this[item.name] = item.unpack(data, offset, count);
		offset += length * count;
	}
	return this;
};
TypeStruct.prototype.pack = function () {
	var sizeItem = intItem(), idItem = intItem(), padItem = byteItem();
	var values = [
		this.size + idItem.type.length + padItem.type.length,
		exports.typeIds[this.constructor.name],
		1,
	];
	for (var i = 0; i < this.constructor.items.length; i++) {
		var item = this.constructor.items[i];
		var value = (this[item.name] !== undefined ? this[item.name] :
					 item.type.defaultValue);
		if (item.type instanceof VarType) {
			var length = value.length;
			if (!value) length++;	// NULL
			for (var j = 0; j < item.countLength; j++) {
				values.push(length >> (j << 3));
			}
		}
		if (item instanceof ArrayItem) {
			console.assert(item.countItemName in this);
			console.assert(this[item.countItemName] === value.length);
			values = values.concat(value);
		}
		else if (item.type instanceof TypeTuple) {
			values = values.concat(value);
		}
		else values.push(value);
	}
	//console.log(this.format, values);														// debug
	var fmt = ("<" + sizeItem.type.format + idItem.type.format +
			   padItem.type.format + this.format);
	return bufferpack.pack(fmt, values);
};
TypeStruct.prototype.requiresVersion = true;
TypeStruct.prototype.requiresLogin = true;
Object.defineProperty(TypeStruct.prototype, "format", {
	get: function () {
		var format = "<";
		for (var i = 0; i < this.constructor.items.length; i++) {
			var item = this.constructor.items[i];
			if (item.type instanceof VarType) {
				console.assert(this[item.name],
							   item.name + " not in " + this.constructor);
				format += item.countLength + "B" + this[item.name].length;
			}
			if (item instanceof ArrayItem) {
				format += item.type.format.repeat(this[item.name].length);
			}
			else format += item.type.format;
		}
		return format;
	},
});
Object.defineProperty(TypeStruct.prototype, "size", {
	get: function () {
		return bufferpack.calcLength("<" + this.format);
	},
});
function registerStructType(type, id) {
	console.assert(!(id in exports.types), id + " already registered.");
	exports.types[id] = type;
	exports.typeIds[type.name] = id;
	exports[type.name] = type;
}

/**
 * @see lsError1Struct in lsTypes.h
 */
function Error1(items) {
	TypeStruct.call(this, items);
}
Error1.prototype = new TypeStruct;
Error1.prototype.constructor = Error1;
Error1.prototype.requiresVersion = true;
Error1.prototype.requiresLogin = false;
Error1.items = [
	intItem("type"),
	intItem("id"),
	stringItem("msg", 250),
];
Error1.types = {
	general: 0,
	login: 1,
	
	objectCreation: 3,
	objectDestruction: 4,
	objectAvatar: 5,
	objectPosition: 6,
	objectNickname: 8,
	
	objectSaying: 9,
	
	objectGroupObserverDeletion: 7,
};
registerStructType(Error1, 1);
exports.errors = Error1.types;

///**
// * @see lsTest1Struct in lsTypes.h
// */
//function Test1() {}
//Test1.prototype = new TypeStruct;
//Test1.prototype.constructor = Test1;
//Test1.items = [
//	stringItem("msg", 250),
//];
//registerStructType(Test1, 2);

/**
 * @see lsVersion1Struct in lsTypes.h
 */
function Version1(items) {
	TypeStruct.call(this, items);
}
Version1.prototype = new TypeStruct;
Version1.prototype.constructor = Version1;
Version1.prototype.requiresVersion = false;
Version1.prototype.requiresLogin = false;
Version1.items = [
	intItem("version"),
	intItem("minVersion"),
	stringItem("appName", 50),
	intItem("appVersion"),
	stringItem("appTarget", 20),
	stringItem("os", 100),
	//stringItem("language"),
];
registerStructType(Version1, 3);

/**
 * @see lsLogin3Struct in lsTypes.h
 */
function Login3(items) {
	TypeStruct.call(this, items);
}
Login3.prototype = new TypeStruct;
Login3.prototype.constructor = Login3;
Login3.prototype.requiresVersion = true;
Login3.prototype.requiresLogin = false;
Login3.items = [
	stringItem("userName", 50),
	intItem("userId"),
	stringItem("password", 50),
	stringItem("url", 254),
	stringItem("clientIdent", 254),
];
registerStructType(Login3, 4);

/**
 * @see lsLoginAck1Struct in lsTypes.h
 */
function LoginAck1(items) {
	TypeStruct.call(this, items);
}
LoginAck1.prototype = new TypeStruct;
LoginAck1.prototype.constructor = LoginAck1;
LoginAck1.items = [
	stringItem("userName", 50),
	intItem("userId"),
	intItem("cid"),
];
registerStructType(LoginAck1, 5);

///**
// * @see lsObsCreate1Struct in lsTypes.h
// */
//function ObsCreate1() {}
//ObsCreate1.prototype = new TypeStruct;
//ObsCreate1.prototype.constructor = ObsCreate1;
//ObsCreate1.items = [
//	intItem("owner"),
//	stringItem("worldName", 254),
//	intItem("wiid"),
//	intItem("numObs"),
//	stringItem("comingFrom", 254),
//	intItem("cookie"),
//];
//registerStructType(ObsCreate1, 6);

/**
 * @see lsObsCreateAck1Struct in lsTypes.h
 */
function ObsCreateAck1(items) {
	TypeStruct.call(this, items);
}
ObsCreateAck1.prototype = new TypeStruct;
ObsCreateAck1.prototype.constructor = ObsCreateAck1;
ObsCreateAck1.items = [
	intItem("owner"),
	stringItem("worldName", 254),
	
	intItem("wiid"),
	intItem("numObs"),
	arrayItem(TypeInt, "obs", "numObs"),
	intItem("cookie"),
];
registerStructType(ObsCreateAck1, 7);

/**
 * @see lsObsDestroy1Struct in lsTypes.h
 */
function ObsDestroy1(items) {
	TypeStruct.call(this, items);
}
ObsDestroy1.prototype = new TypeStruct;
ObsDestroy1.prototype.constructor = ObsDestroy1;
ObsDestroy1.items = [
	intItem("numObs"),
	arrayItem(TypeInt, "obs", "numObs"),
];
registerStructType(ObsDestroy1, 8);

/**
 * @see lsAddOb1Struct in lsTypes.h
 */
function AddOb1(items) {
	TypeStruct.call(this, items);
}
AddOb1.prototype = new TypeStruct;
AddOb1.prototype.constructor = AddOb1;
AddOb1.items = [
	intItem("gid"),
	intItem("oid"),
];
registerStructType(AddOb1, 9);

/**
 * @see lsRemoveOb1Struct in lsTypes.h
 */
function RemoveOb1(items) {
	TypeStruct.call(this, items);
}
RemoveOb1.prototype = new TypeStruct;
RemoveOb1.prototype.constructor = RemoveOb1;
RemoveOb1.items = [
	intItem("gid"),
	intItem("oid"),
];
registerStructType(RemoveOb1, 10);

/**
 * @see lsObGroupDelObserver1Struct in lsTypes.h
 */
function ObGroupDelObserver1(items) {
	TypeStruct.call(this, items);
}
ObGroupDelObserver1.prototype = new TypeStruct;
ObGroupDelObserver1.prototype.constructor = ObGroupDelObserver1;
ObGroupDelObserver1.items = [
	intItem("gid"),
];
registerStructType(ObGroupDelObserver1, 12);

/**
 * @see lsObGroupObserverAdded1Struct in lsTypes.h
 */
function ObGroupObserverAdded1(items) {
	TypeStruct.call(this, items);
}
ObGroupObserverAdded1.prototype = new TypeStruct;
ObGroupObserverAdded1.prototype.constructor = ObGroupObserverAdded1;
ObGroupObserverAdded1.items = [
	intItem("gid"),
	//intItem("cid"),
	intItem("numObs"),
	arrayItem(TypeInt, "obs", "numObs"),
];
registerStructType(ObGroupObserverAdded1, 13);

/**
 * @see lsObGroupObserverRemoved1Struct in lsTypes.h
 */
function ObGroupObserverRemoved1(items) {
	TypeStruct.call(this, items);
}
ObGroupObserverRemoved1.prototype = new TypeStruct;
ObGroupObserverRemoved1.prototype.constructor = ObGroupObserverRemoved1;
ObGroupObserverRemoved1.items = [
	intItem("gid"),
	//intItem("cid"),
];
registerStructType(ObGroupObserverRemoved1, 14);

/**
 * @see lsObAvatar1Struct in lsTypes.h
 */
function ObAvatar1(items) {
	TypeStruct.call(this, items);
}
ObAvatar1.prototype = new TypeStruct;
ObAvatar1.prototype.constructor = ObAvatar1;
ObAvatar1.items = [
	intItem("oid"),
	stringItem("url", 254),
];
registerStructType(ObAvatar1, 17);

/**
 * @see lsObPosition1Struct in lsTypes.h
 */
function ObPosition1(items) {
	TypeStruct.call(this, items);
}
ObPosition1.prototype = new TypeStruct;
ObPosition1.prototype.constructor = ObPosition1;
ObPosition1.items = [
	intItem("oid"),
	tupleItem(realItem(), "pos", 6),
];
registerStructType(ObPosition1, 18);

/**
 * @see lsObNickname1Struct in lsTypes.h
 */
function ObNickname1(items) {
	TypeStruct.call(this, items);
}
ObNickname1.prototype = new TypeStruct;
ObNickname1.prototype.constructor = ObNickname1;
ObNickname1.items = [
	intItem("oid"),
	stringItem("nickname", exports.MAX_NICK_SIZE),
];
registerStructType(ObNickname1, 19);

/**
 * @see lsSay1Struct in lsTypes.h
 */
function Say1(items) {
	TypeStruct.call(this, items);
}
Say1.prototype = new TypeStruct;
Say1.prototype.constructor = Say1;
Say1.items = [
	intItem("fromId"),
	intItem("toId"),
	stringItem("text", 1024),
];
registerStructType(Say1, 20);

/**
 * @see lsSay2Struct in lsTypes.h
 */
function Say2(items) {
	TypeStruct.call(this, items);
}
Say2.prototype = new TypeStruct;
Say2.prototype.constructor = Say2;
Say2.items = [
	intItem("fromId"),
	intItem("toId"),
	stringItem("target", 254),
	stringItem("text", 1024),
];
registerStructType(Say2, 23);

/**
 * @see lsModerator1Struct in lsTypes.h
 */
function Moderator1(items) {
	TypeStruct.call(this, items);
}
Moderator1.prototype = new TypeStruct;
Moderator1.prototype.constructor = Moderator1;
Moderator1.items = [
	intItem("purpose"),
	stringItem("clientIdent", 254),
	stringItem("worldName", 254),
	stringItem("privileges", 254),
	intItem("expiration"),	// actually a time_t
	intItem("oid"),
	intItem("flags"),
];
registerStructType(Moderator1, 25);
exports.moderatorPurposes = {
	//* @see MOD_PRIV in lsTypes.h
	privilege: 0,
	//* @see MOD_ASSC in lsTypes.h
	association: 1,
	//* @see MOD_KILLASSC in lsTypes.h
	dissociation: 2,
};

/**
 * @see lsObsCreate2Struct in lsTypes.h
 */
function ObsCreate2(items) {
	TypeStruct.call(this, items);
}
ObsCreate2.prototype = new TypeStruct;
ObsCreate2.prototype.constructor = ObsCreate2;
ObsCreate2.items = [
	intItem("owner"),
	stringItem("worldName", 254),
	stringItem("reference", 254),
	intItem("wiid"),
	intItem("numObs"),
	stringItem("comingFrom", 254),
	intItem("cookie"),
];
registerStructType(ObsCreate2, 32);

/**
 * @see lsAddObWithName1Struct in lsTypes.h
 */
function AddObWithName1(items) {
	TypeStruct.call(this, items);
}
AddObWithName1.prototype = new TypeStruct;
AddObWithName1.prototype.constructor = AddObWithName1;
AddObWithName1.items = [
	intItem("gid"),
	intItem("oid"),
	stringItem("name", 254),
];
registerStructType(AddObWithName1, 33);

/**
 * @see lsBroadcast1Struct in lsTypes.h
 */
function Broadcast1(items) {
	TypeStruct.call(this, items);
}
Broadcast1.prototype = new TypeStruct;
Broadcast1.prototype.constructor = Broadcast1;
Broadcast1.items = [
	stringItem("clientIdent", 254),
	stringItem("worldName", 254),
	stringItem("info", 2048),
	intItem("oid"),
];
registerStructType(Broadcast1, 34);

/**
 * @see lsObsCreate3Struct in lsTypes.h
 */
function ObsCreate3(items, moreItems) {
	TypeStruct.call(this, items, moreItems);
}
ObsCreate3.prototype = new TypeStruct;
ObsCreate3.prototype.constructor = ObsCreate3;
ObsCreate3.items = [
	intItem("owner"),
	stringItem("worldName", 254),
	stringItem("reference", 254),
	stringItem("pageURL", 254),
	intItem("wiid"),
	intItem("numObs"),
	stringItem("comingFrom", 254),
	intItem("cookie"),
];
registerStructType(ObsCreate3, 40);

///**
// * @see lsObsCreateWithName1Struct in lsTypes.h
// */
//function ObsCreateWithName1() {}
//ObsCreateWithName1.prototype = new TypeStruct;
//ObsCreateWithName1.prototype.constructor = ObsCreateWithName1;
//ObsCreateWithName1.items = [
//	intItem("owner"),
//	intItem("wiid"),
//	intItem("oid"),
//	stringItem("name", 254),
//	stringItem("type", 254),
//	intItem("numProperties"),
//	arrayItem(TypeString, "prop_names", "numProperties"),
//	arrayItem(TypeInt, "prop_perms", "numProperties"),
//	arrayItem(TypeString, "prop_values", "numProperties"),
//	intItem("cookie"),
//];
//registerStructType(ObsCreateWithName1, 26);
//
///**
// * @see lsPing1Struct in lsTypes.h
// */
//function Ping1() {}
//Ping1.prototype = new TypeStruct;
//Ping1.prototype.constructor = Ping1;
//Ping1.items = [
//	intItem("cookie"),
//];
//registerStructType(Ping1, 15);
//
///**
// * @see lsPong1Struct in lsTypes.h
// */
//function Pong1() {}
//Pong1.prototype = new TypeStruct;
//Pong1.prototype.constructor = Pong1;
//Pong1.items = [
//	intItem("cookie"),
//];
//registerStructType(Pong1, 16);
