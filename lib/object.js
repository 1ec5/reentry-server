const objectobserver = require("./objectobserver");
const types = require("./types");

//* @see lsObMinSayDelay in lsOb.c
const MIN_SAY_INTERVAL = 0.1 /* s */;

//* @see lsObMaxSayQueue in lsOb.c
const MAX_QUEUED_SAYINGS = 60;

/**
 * @see lsObStruct in lsOb.h
 */
exports.Object = function (proxy, owner, worldInstance, id, isAppObject, name, notifyGroup) {
	this.owner = owner;
	this.proxy = proxy;
	this.worldInstance = worldInstance;	// worldInst
	
	this.id = id || worldInstance.world.server.generateId();	// oid
	
	this.groups = [];
	this.observers = [];	// obObservers
	this.sharedObservers = [];	// sharedObservers
	this.sayingQueue = [];	// sayQueue
	this.lastSayingTime = 0;	// lastSaid
	this.sayingIntervalId = setInterval(this.pumpSayingQueue.bind(this),
										MIN_SAY_INTERVAL * 1000 /* ms / s */);
	
	this.approvedAvatarId = -1;	// approvedAvOffset
	this.remoteId = -1;	// mapId
	this.name = name;
	this.isGlobal = true;	// global
	this.properties = {};
	
	if (isAppObject) worldInstance.appObjects.push(id);
	
	this.proxy.objects.push(this);
	if (notifyGroup) worldInstance.group.addObject(this);
};

exports.Object.prototype = {
	_avatarUrl: undefined,
	get avatarUrl() {
		return this._avatarUrl;
	},
	set avatarUrl(url) {
		this._avatarUrl = url;
		this.markAsDirty(objectobserver.dirtyAttrsAvatar);
	},
	
	_position: [[0, 0, 0], [0, 0, 0]],
	get position() {
		return this._position;
	},
	set position(pos) {
		this._position = pos;
		this.markAsDirty(objectobserver.dirtyAttrsPosition);
	},
	
	_nickname: undefined,
	get nickname() {
		return this._nickname;
	},
	set nickname(nick) {
		this._nickname = nick;
		this.markAsDirty(objectobserver.dirtyAttrsNickname);
	},
	
	get isSquelched() {
		return this.proxy.isSquelched;
	},
};

exports.Object.prototype.isAppObject = function () {
	return this.worldInstance.appObjects.indexOf(this.id) >= 0;
};

/**
 * @see lsObObserverBegin in lsObObserver.h
 */
exports.Object.prototype.addObserver = function (socket) {
	var observer;
	for (var i = 0; i < this.observers.length; i++) {
		if (this.observers[i].socket == socket) {
			observer = this.observers[i];
			break;
		}
	}
	if (observer) observer.numInstances++;
	else new objectobserver.ObjectObserver(this, socket);
};

/**
 * @see lsObObserverEnd in lsObObserver.c
 */
exports.Object.prototype.removeObserver = function (socket) {
	var idx = this.observers.findIndex(function (observer, idx, observers) {
		return observer.socket === socket;
	});
	if (idx < 0) return;	// TODO: Also log.
	var observer = this.observers[idx];
	if (--observer.numInstances > 0) return;
	
	// lsObObserverKill() in lsObObserver.c
	socket.removeObserver(observer);
	// lsObDelObObserver() in lsOb.c
	this.observers.splice(idx, 1);
};

/**
 * @see lsObDirty() in lsOb.c
 */
exports.Object.prototype.markAsDirty = function (attrs) {
	this.observers.forEach(function (obs, idx, arr) {
		obs.markAsDirty(attrs);
	});
};

/**
 * @see lsObSayCallback() in lsOb.c
 */
exports.Object.prototype.pumpSayingQueue = function () {
	if (!this.proxy) return;
	var saying = this.sayingQueue.shift();
	if (!saying) return;
	
	this.sayImmediately(saying);
	this.lastSayingTime += MIN_SAY_INTERVAL * 1000 /* ms / s */;
};

/**
 * @see lsObSay_() in lcOb.c
 */
exports.Object.prototype.sayImmediately = function (saying) {
	var proxy = this.proxy;
	var worlds;
	if (proxy.broadcastMode == proxy.BROADCAST_MODE_WORLD) {
		worlds = [this.worldInstance.world];
	}
	else if (proxy.broadcastMode == proxy.BROADCAST_MODE_UNIVERSE) {
		worlds = this.worldInstance.world.server.worlds;
	}
	if (worlds) {
		worlds.forEach(function (world, idx, worlds) {
			world.instances.forEach(function (instance, idx, instances) {
				if (instance.group.observers.length) {
					instance.group.hear(saying, proxy.clientIdent);
				}
			});
		});
		return false;
	}
	
	// lsRemoteClientFindGroup()
	var audience = proxy.observingGroupsById.get(saying.toId);
	if (audience) {
		audience.hear(saying, proxy.clientIdent);
		return true;
	}
	
	// lsRemoteClientFindOtherOb()
	var listener = proxy.observers.find(function (observer, idx, observers) {
		return observer.object.id === saying.toId;
	});
	if (listener) {
		listener.hear(saying, proxy.clientIdent);
		return true;
	}
	
	proxy.die(types.errors.objectSaying, saying.toId,
			  "Attempted to speak to an object you aren’t observing.");
	return false;
};

/**
 * @see lsObSay() in lsOb.c
 */
exports.Object.prototype.say = function (saying) {
	var now = Date.now();
	if (!this.sayingQueue.length &&
		now - this.lastSayingTime >= MIN_SAY_INTERVAL * 1000 /* ms / s */) {
		this.lastSayingTime = now;
		return this.sayImmediately(saying);
	}
	
	if (this.sayingQueue.length >= MAX_QUEUED_SAYINGS) {
		if (!this.proxy) return false;
		this.proxy.die(types.errors.objectSaying, saying.toId,
					   "Too many Say messages backed up. Dropping one.");
		return false;
	}
	
	this.sayingQueue.push(new types.Say2(saying));
	return false;
};

/**
 * @see lsEndBroadcast() in lsWorld.c
 */
exports.Object.prototype.endBroadcast = function () {
	// TODO: Lots more to fill in here.
	this.proxy.send(new types.Broadcast1({
		clientIdent: this.proxy.clientIdent,
		worldName: this.worldInstance.world.worldName,
		info: "END",
		oid: this.id,
	}));
};

/**
 * @see lsObKill() in lsOb.c
 */
exports.Object.prototype.detach = function () {
	var proxy = this.proxy;
	if (!proxy) return;
	if (proxy.broadcastMode) this.endBroadcast();
	if (proxy.dependencyLevel === proxy.DEPENDENCY_LEVEL_SLAVE && this.isGlobal) {
		// TODO: Call lsRemoteMaster_ObKill() on remote master.
	}
	for (var i = this.groups.length - 1; i >= 0; i--) {
		this.groups[i].removeObject(this);
	}
	for (var i = this.observers.length - 1; i >= 0; i--) {
		proxy.removeObserver(this.observers[i]);
	}
	this.properties = {};
	this.sharedObservers = [];
	
	// lsRemoteClientDelOb()
	var idxInProxy = proxy.objects.indexOf(this);
	if (idxInProxy >= 0) proxy.objects.splice(idxInProxy, 1);	// TODO: Else log.
	
	this.worldInstance.removeAppObject(this);
	
	this.groups = [];
	this.observers = [];
	this.sayingQueue = [];
	clearTimeout(this.sayingIntervalId);
	delete this.proxy;
};
