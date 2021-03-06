const types = require("./types");
const objectobserver = require("./objectobserver");

/**
 * @see lsObGroupStruct in lsObGroup.h
 * @see lsObGroupCreate in lsObGroup.h
 */
function ObjectGroup(server, id) {
	this.id = id || server.generateId();	// gid
	this.objects = [];	// obs
	this.observers = [];	// observers
	this.server = server;	// lss
	this.name = undefined;	// name
}

/**
 * @see lsObGroupAddOb in lsObGroup.h
 */
ObjectGroup.prototype.addObject = function (object) {
	if (!object) throw "No object to add.";
	
	object.groups.push(this);
	this.objects.push(object);
	
	for (var i = 0; i < this.observers.length; i++) {
		var socket = this.observers[i];
		if (socket.version.appVersion < 3) {
			if (object.isAppObject() || object.name) continue;
			
			socket.send(new types.AddOb1({
				gid: this.id,
				oid: object.id,
			}));
		}
		else if (object.isAppObject()) {
			socket.send(new types.AddObWithName1({
				gid: this.id,
				oid: object.id,
				name: null,
			}));
		}
		else if (!object.name) {
			socket.send(new types.AddOb1({
				gid: this.id,
				oid: object.id,
			}));
		}
		
		if (object.proxy != socket) object.addObserver(socket);
	}
};

/**
 * @see lsObGroupDelOb() in lsObGroup.c
 */
ObjectGroup.prototype.removeObject = function (obj) {
	var objIdx = this.objects.indexOf(obj);
	if (objIdx < 0) return;	// TODO: Also log.
	this.objects.splice(objIdx, 1);
	
	// lsObDelGroup()
	var groupIdx = obj.groups.indexOf(this);
	if (groupIdx < 0) return;	// TODO: Also log.
	obj.groups.splice(groupIdx, 1);
	
	var groupId = this.id;
	this.observers.forEach(function (socket, idx, observers) {
		if (obj.proxy !== socket) obj.removeObserver(socket);
		socket.send(new types.RemoveOb1({
			gid: groupId,
			oid: obj.id,
		}));
	});
};

/**
 * @see lsObGroupAddObserver() in lsObGroup.h
 */
ObjectGroup.prototype.addObserver = function (socket) {
	socket.observingGroupsById.set(this.id, this);
	this.observers.push(socket);
	
	var objectIds = [];
	for (var i = 0; i < this.objects.length; i++) {
		var obj = this.objects[i];
		if (!obj.isAppObject()) objectIds.push(obj.id);
		else if (socket.version.appVersion >= 3) {
			socket.send(new types.AddObWithName1({
				gid: this.id,
				oid: object.id,
				name: null,
			}));
		}
	}
	
	var obGroupObserverAdded1 = new types.ObGroupObserverAdded1({
		gid: this.id,
		//cid: socket.clientId,
		numObs: objectIds.length,
		obs: objectIds,
	});
	obGroupObserverAdded1.length = objectIds.length;
	var objectGroup = this;
	socket.send(obGroupObserverAdded1, function () {
		if (socket.version.appVersion > 2) {
			for (var i = 0; i < objectGroup.objects.length; i++) {
				var object = objectGroup.objects[i];
				if (object.proxy !== socket) object.addObserver(socket);
			}
		}
		else for (var i = 0; i < objectGroup.objects.length; i++) {
			var object = objectGroup.objects[i];
			if (!object.isAppObject() && object.proxy != socket) {
				object.addObserver(socket);
			}
		}
	});
};

/**
 * @see lsObGroupDelObserver() in lsObGroup.c
 */
ObjectGroup.prototype.removeObserver = function (socket) {
	var idx = this.observers.indexOf(socket);
	if (idx < 0) return;	// TODO: Also log.
	
	this.observers.splice(idx, 1);
	this.objects.forEach(function (obj, idx, objects) {
		if (obj.proxy !== socket) obj.removeObserver(socket);
	});
	
	socket.send(new types.ObGroupObserverRemoved1({
		gid: this.id,
		//cid: socket.clientId,
	}));
};

/**
 * @see lsObGroupHearSay() in lsObGroup.c
 */
ObjectGroup.prototype.hear = function (saying, clientIdent) {
	this.observers.forEach(function (observer, idx, observers) {
		observer.heardCurrentSaying = false;
	});
	this.observers.forEach(function (observer, idx, observers) {
		if (!observer.heardCurrentSaying) observer.hear(saying, clientIdent);
	});
};

exports.ObjectGroup = ObjectGroup;
