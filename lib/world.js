const types = require("./types");
const config = require("./config");
const object = require("./object");
const objectgroup = require("./objectgroup");

/**
 * @see lsWorldStruct in lsWorld.h
 * @see lsWorldCreate() in lsWorld.c
 */
function World(server, worldName, worldUrl, pageUrl) {
	this.worldName = worldName;
	this.worldUrl = worldUrl;	// worldURL
	this.pageUrl = pageUrl;	// pageURL
	
	this.instances = [];
	
	this.maxObjects = 13 * 2;	// maxObs
	//* Number of vacant objects for matching.
	this.headRoom = this.maxObs / 4;
	
	this._transitionCache = [];	// recentTransitions
	this.reservations = {};	// (by id)
	
	this.server = server;	// lss
	this.private = true;	// priv
	this.canChat = true;	// chatdefault
	this.passwords = [];
	this.broadcastPasswords = [];	// bpasswords
	this.approvedAvatars = [];	// approvedAvs
	this.defaultAvatar = undefined;	// defaultAv
}

World.prototype = {
	/**
	 * @see totalObs
	 */
	get totalObjects() {
		var sum = 0;
		this.instances.forEach(function (instance, idx, instances) {
			sum += instance.appObjects.length;
		});
		return sum;
	},
};

/**
 * Prunes and returns the cached list of recent transitions.
 * 
 * @see lsWorldPruneRecentTransitions() in lsWorld.c
 */
World.prototype.getRecentTransitions = function (now) {
	var cutoff = now - config.transitionExpiry;
	if (cutoff < 0) cutoff = 0;
	
	this._transitionCache = this._transitionCache.filter(function (elt, idx, arr) {
		return elt.time >= cutoff;
	});
	return this._transitionCache;
};

/**
 * @throws {string} if too many objects are created at once or world entry
 * 					failed.
 * @see lsWorld_ObsCreate() in lsWorld.c
 */
World.prototype.addObjects = function (objects, socket, server) {
	// Check sanity.
	var isSlave = socket.userId == config.users.slave.userId;
	if (objects.numObs > config.maxObjectsCreatedSimultaneously) {
		throw ("Cannot create more than " +
			   config.maxObjectsCreatedSimultaneously + " objects at a time.");
	}
	if (!isSlave &&
		socket.objects.length + objects.numObs > server.maxObjectsPerClient) {
		throw ("Cannot create more than " + server.maxObjectsPerClient +
			   " objects total.");
	}
	if (!isSlave && objects.owner != socket.clientId) {
		throw ("Client #" + socket.clientId +
			   " may not create objects for object #" + objects.owner +
			   " to own.");
	}
	
	// Choose a world instance and create the objects in it.
	var instance = this.getInstance(objects, socket);
	if (!instance) throw "Failed to enter world. Servers may all be full.";
	
	// TODO: Master should reserve space and redirect object creation to slave.
	instance.addObjects(objects, socket);
};

/**
 * @see lsWorldDelRef() in lsWorld.c
 */
World.prototype.detachIfUnused = function () {
	if (this.instances.length || this._transitionCache.length ||
		Object.keys(this.reservations).length) {
		return;
	}
	
	this.instances = [];
	this._transitionCache = [];
	this.reservations = {};
	this.passwords = [];
	this.broadcastPasswords = [];
	this.approvedAvatars = [];
};

/**
 * @throws {string} if the requested world instance could not be found or cannot
 * 					fulfill the request.
 * @see lsWorld_FindInst() in lsWorld.c
 */
World.prototype.getInstance = function (objects, socket) {
	if (objects.numObs < 1 || objects.numObs > this.maxObjects) {
		throw "Unable to create " + objects.numObs + " objects.";
	}
	
	// Honor a request to go to a specific instance.
	if (objects.wiid) {
		// Reservation IDs are negative.
		var instance;
		if (objects.wiid < 0) {
			var reservation = this.reservations[objects.wiid];
			if (!reservation || reservation.numObjects != objects.numObs) {
				throw "Reservation #" + objects.wiid + " is forged or expired.";
			}
			
			instance = reservation.worldInstance;
			console.log("Reservation #" + reservation.id +
						" maps to world instance #" + instance.group.id +
						" (" + reservation.numObjects + " objects).");
			
			// Scratch off the reservation.
			reservation.cancel();
			reservation.numObjects = 0;
		}
		else for (var i = 0; i < this.instances.length; i++) {
			if (this.instances[i].id == objects.wiid) {
				instance = this.instances[i];
				break;
			};
		}
		
		if (!instance) throw "World instance #" + objects.wiid + " doesn’t exist.";
		
		if (instance.numUnavailable + objects.numObs > world.maxObjects) {
			throw ("Not enough room for " + objects.numObs +
				   " more objects in world instance #" + objects.wiid +
				   ", which already has " + instance.numUnavailable +
				   " and can only hold up to " + world.maxObjects + ".");
		}
		
		console.log("World instance #" + objects.wiid + " has enough room.");
		return instance;
	}
	
	// Honor a request to travel with others coming from a particular world.
	if (objects.comingFrom) {
		var now = new Date();
		var recentTransitions = this.getRecentTransitions(now);
		for (var i = 0; i < recentTransitions; i++) {
			var transition = recentTransitions[i];
			if (transition.to.numUnvailable + objects.numObjects > this.maxObjects ||
				transition.from == objects.comingFrom) {
				continue;
			}
			
			var elapsedTime = (now - transition.time) / 1000 /* ms/s */;
			console.log("Found recent transition " + elapsedTime + " s ago from " +
						transition.from + ".");
			recentTransitions.splice(i, 1);
			transition.time = now;
			recentTransitions.push(transition);
			
			return transition.to;
		}
	}
	
	// Find the busiest instance.
	var busiestInstance;
	for (var i = 0; i < this.instances.length; i++) {
		var instance = this.instances[i];
		if (!busiestInstance ||
			(instance.numUnvailable > busiestInstance.numUnvailable &&
			 instance.numUnavailable + this.headRoom + objects.numObs <= this.maxObjects) ||
			(instance.slave == socket &&
			 instance.numUnavailable == busiestInstance.numUnavailable)) {
			busiestInstance = instance;
		}
	}
	var instance = busiestInstance;
	
	// If the existing instance is unsuitable, create a new one.
	if (!instance ||
		instance.numUnavailable + this.headRoom + objects.numObs > this.maxObjects) {
		
		// TODO: The master should choose the slave with the most room.
		instance = new WorldInstance(this, 0);
		
		this.instances.push(instance);
	}
	
	if (objects.comingFrom) {
		this.getRecentTransitions().push(new WorldTransition(objects.comingFrom,
															 instance));
	}
	
	return instance;
};

/**
 * @see lsWorldForgetInst() in lsWorld.c
 */
World.prototype.removeInstance = function (instance) {
	var idx = this.instances.indexOf(instance);
	if (idx >= 0) this.instances.splice(idx, 1);
	
	for (var i = this._transitionCache.length - 1; i >= 0; i--) {
		var transition = this._transitionCache[i];
		if (transition.to === instance) this._transitionCache.splice(i, 1);
	}
};

exports.World = World;

/**
 * @see lsWorldInstStruct in lsWorld.h
 * @see lsWorldInstCreate in lsWorld.c
 */
function WorldInstance(world, id, slave) {
	this.world = world;	// w
	this.group = new objectgroup.ObjectGroup(world.server, id);	// g
	this.slave = slave;	// slave
	
	this.numReserved = 0;	// reserved
	
	this.appObjects = [];	// appObs
	this.serverGroups = [];	// sGroups
	this.nextApprovedAvatarId = 0;	// nextApprovedAv
	
	// TODO: Don't make broadcasters for the master.
	this.createBroadcasters();
}

WorldInstance.prototype = {
	get id() {
		return this.group.id;
	},
	set id(id) {
		this.group.id = id;
	},
	
	/**
	 * @see lsWorldInstTotalObs() in lsWorld.c
	 */
	get numUnavailable() {
		return (this.group ? this.group.objects.length : 0) + this.numReserved;
	},
};

/**
 * @see makeBroadcasters() in lsWorld.c
 */
WorldInstance.prototype.createBroadcasters = function () {
	// TODO: Should the calls to server.broadcast() be chained synchronously?
	var server = this.world.server;
	for (var i = 0; i < server.sockets; i++) {
		var socket = server.sockets[i];
		if (socket.isDummy) {
			for (var j = 0; j < socket.objects; j++) {
				var obj = socket.objects[j];
				if (this != obj &&
					this.world.worldName == obj.worldInstance.world.worldName) {
					server.broadcast({
						clientIdent: socket.clientIdent,
						worldName: this.world.worldName,
						remoteId: obj.remoteId,
						nickname: obj.nickname,
						position: obj.position,
						avatarUrl: obj.avatarUrl,
					});
				}
			}
		}
	}
	
	var isClipped = true;
	while (isClipped) {
		isClipped = false;
		for (var i = 0; i < server.broadcasters; i++) {
			var broadcaster = server.broadcasters[i];
			if (this.world.worldName == broadcaster.worldName) {
				server.broadcast(broadcaster);
				var idx = server.broadcasters.indexOf(broadcaster);
				if (idx >= 0) server.broadcasters.splice(idx, 1);
				isClipped = true;
				break;
			}
		}
	}
};

/**
 * @see lsWorldInst_ObsCreate() in lsWorld.c
 */
WorldInstance.prototype.addObjects = function (objects, socket) {
	var ids = objects.obs;
	var cookie = objects.cookie || objects.clientCookie;
	
	if (objects.numObs > config.maxObjectsCreatedSimultaneously) {
		throw ("Cannot create " + objects.numObs + " objects at one time, only " +
			   config.maxObjectsCreatedSimultaneously + ".");
	}
	
	var objectIds = [];
	for (var i = 0; i < objects.numObs; i++) {
		var obj = new object.Object(socket, objects.owner, this, ids ? ids[i] : 0,
									i == 1, undefined, true);
		if (!obj) throw "Unable to create object.";
		if (socket.clientIdent && this.world.server.master) {
			// TODO: Do moderator messages need to be chained synchronously?
			socket.send(new types.Moderator1({
				purpose: types.moderatorPurposes.association,
				clientIdent: socket.clientIdent,
				oid: obj.id,
			}));
			// TODO: Act upon the moderator message.
		}
		objectIds.push(obj.id);
	}
	
	var worldInstance = this;
	socket.send(new types.ObsCreateAck1({
		owner: objects.owner,
		worldName: this.world.worldName,
		wiid: this.group.id,
		numObs: objects.numObs,
		obs: objectIds,
		cookie: cookie,
	}), function () {
		if (socket.userId != config.users.slave.userId &&
			worldInstance.group.observers.indexOf(socket) <= 0) {
			worldInstance.group.addObserver(socket);
		}
	});
};

WorldInstance.prototype.removeAppObject = function (appObj) {
	var idx = this.appObjects.indexOf(appObj);
	if (idx >= 0) this.appObjects.splice(idx, 1);
	
	this.detachIfUnused();
};

/**
 * @see lsWorldInstDelRef() in lsWorld.c
 */
WorldInstance.prototype.detachIfUnused = function () {
	// FIXME: Call lsNamedObDeleteAll()?
	if (this.appObjects.length && this.numUnavailable > 0) return;	// TODO: And log.
	this.world.removeInstance(this);
	this.world.detachIfUnused();
	this.appObjects = [];
	this.serverGroups = [];
};

/**
 * @see lsWorldInstObsReservationStruct in lsWorld.c
 */
function WorldInstanceObjectReservation(worldInstance, numObjects, id) {
	this.worldInstance = worldInstance;	// wi
	this.numObjects = numObjects;	// numObs
	this.id = id;	// resNum (< 0)
}

/**
 * @see lsWorldInstUnreserveObs() in lsWorld.c
 */
WorldInstanceObjectReservation.prototype.cancel = function () {
	this.worldInstance.numReserved -= this.numObjects;
	if (this.worldInstance.slave) {
		this.worldInstance.slave.numReserved -= this.numObjects;
	}
	delete this.worldInstance.world.reservations[this.id];
};

/**
 * @see lsWorldTransitionStruct in lsWorld.c
 */
function WorldTransition(from, to) {
	this.from = from || "?";	// comingFrom
	this.to = to;	// goingTo
	this.date = new Date();	// when
}
