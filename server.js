#!/usr/bin/env node

const net = require("net");
const os = require("os");
const stream = require("stream");

const bufferpack = require("bufferpack");

require("es6-shim");

const config = require("config");
const limits = require("limits");
const types = require("types");

const world = require("world");
const objectobserver = require("objectobserver");

String.prototype.isVowel = function () {
	return "aeiouy".indexOf(this[0].toLowerCase());
};

// Greet the user.
console.log(config.productName + " " + config.productVersion.join("."));
console.log(config.protocolName + " " + config.protocolVersion.join("."));
//console.log("Based on " + config.predecessorName + " " +
//			config.predecessorVersion.join("."));
console.log();

// Listen for connections.
var server = net.createServer();
server.listen(config.port, function () {
	var addrDesc;
	var addr = server.address();
	if (addr.address == "127.0.0.1") addr.address = "localhost";
	if (addr.address == "0.0.0.0") addrDesc = "on port " + addr.port;
	else addrDesc = "to " + addr.address + ":" + addr.port;
	console.log("Listening " + addrDesc + "…");
	console.log();
});

// Since types.LoginAck1 reports client IDs as ints, the total number of
// connections is limited to MAX_INT. Also limit the number of concurrent
// connections this way.
server.maxConnections = limits.maxInt;
server._maxClientId = 0;
Object.defineProperty(server, "maxClientId", {
	get: function () {
		return this._maxClientId;
	},
	//* @throws {string} if all possible client IDs have already been exhausted.
	set: function (id) {
		if (id > limits.maxInt) {
			throw "Maximum client ID " + limits.maxInt + " already issued.";
		}
		this._maxClientId = id;
	},
});

server.sockets = [];
server.broadcasters = [];

//* @see lsSendVersion() in lsRemoteClient.c
server.version = new types.Version1({
	version: config.protocolVersion[0] * 100 + config.protocolVersion[1],
	minVersion: config.protocolVersion[0] * 100 + config.protocolVersion[1],
	appName: config.productName,
	appVersion: config.productVersion[0] * 100 + config.productVersion[1],
	appTarget: os.platform() + "-" + os.arch(),
	os: os.type(),
});

/**
 * Mapping of world names (URLs) to known active worlds.
 *
 * @see lsServerStruct.worlds in lsServer_.h
 */
server.worlds = {};

//* @see lsServerStruct.maxClients in lsServer_.h
server.maxClients = config.maxClients;

//* @see lsServerStruct.maxObsPerClient in lsServer_.h
// TODO: Only config.maxObjectsCreatedSimultaneously for the slave.
server.maxObjectsPerClient = server.maxClients * config.maxObjectsCreatedSimultaneously;

server._nextId = 0;
//server._endId = 0;
//server._idGrant = {
//	start: 0,
//	length: 0,
//};

/**
 * @see lsServerGenId() in lsServer.c
 */
server.generateId = function () {
	// TODO: Enforce a limit on IDs.
	return (this._nextId = (this._nextId + 1) % (limits.maxInt + 1));
};

/**
 * @see lsServerGetWorld() in lsServer.c
 */
server.getWorld = function (worldName, worldUrl, pageUrl) {
	if (worldName in this.worlds) return this.worlds[worldName];
	
	if (!worldName) {
		console.error("Cannot create a nameless world.");
		return undefined;
	}
	
	console.log("Creating world “" + worldName + "”.");
	return this.worlds[worldName] = new world.World(this, worldName, worldUrl,
													pageUrl);
};

/**
 * @see SynthesizeBroadcaster() in lsWorld.c
 */
server.broadcast = function (data) {
	console.assert(false, "server.broadcast() not yet implemented!");
};

server.on("connection", function (socket) {
	var remoteAddr = socket.remoteAddress;
	if (remoteAddr == "127.0.0.1") remoteAddr = "localhost";
	var remoteDesc = remoteAddr + ":" + socket.remotePort;
	
	socket.cipherInKey = config.cipherSeed;
	socket.cipherOutKey = config.cipherSeed;
	
	socket.isDummy = false;
	
	//* @see lsRemoteClientStruct.obs in RemoteClient.h
	socket.objects = [];
	
	//* @see lsRemoteClientStruct.obObservers in RemoteClient.h
	socket.observers = [];
	socket.dirtyObservers = [];
	
	socket.observingGroups = [];
	
	/**
	 * Originally intended to send an Error1 message but instead just kills the
	 * connection.
	 * 
	 * @see lsConnectionKill() in lsConnection.c
	 * @see lsSendError1() in lsConnection.c
	 */
	function die(type, id, msg) {
		console.error("Fatal error:");
		console.error(new types.Error1({type: type, id: id, msg: msg}));
		//socket.end();
		socket.destroy();
	}
	
	// TODO: Slaves must request grants of IDs (lsServerGenId() in lsServer.c).
	try {
		socket.clientId = ++server.maxClientId;
	}
	catch (exc) {
		die(types.errors.general, 0, exc);
		console.error("Attempting to close the server to new connections.");
		server.close();
		return;
	}
	
	server.sockets.push(socket);
	
	/**
	 * @see encryptByte() in lcRawSmartCon.c
	 */
	function encryptByte(u) {
		var e = u ^ socket.cipherOutKey;
		socket.cipherOutKey = (socket.cipherOutKey + u) % (limits.maxUChar + 1);
		return e;
	}
	
	/**
	 * @see decryptByte() in lcRawSmartCon.c
	 */
	function decryptByte(e) {
		var u = e ^ socket.cipherInKey;
		socket.cipherInKey = (socket.cipherInKey + u) % (limits.maxUChar + 1);
		return u;
	}
	
	/**
	 * @see lcSend() in LiveCom.c
	 */
	socket.send = function (struct, callback) {
		if (!(struct.constructor.name in types.typeIds)) {
			die(types.errors.general, 0,
				"Unregistered message type “" + struct.constructor.name + "”.");
			return;
		}
		
		var packetData = struct.pack();
		//console.log(packetData);												// debug
		for (var i = 0; i < packetData.length; i++) {
			packetData[i] = encryptByte(packetData[i]);
		}
		socket.write(packetData, function () {
			socket.lastReceiveTime = new Date();
			
			var type = struct.constructor.name;
			console.log("Sent " + (type[0].isVowel() < 0 ? "a" : "an") + " “" +
						type + "” message to " + remoteDesc + ":");
			console.log(struct);
			
			if (callback) callback();
		});
	}
	
	socket.on("close", function (had_error) {
		var idx = server.sockets.indexOf(socket);
		if (idx >= 0) server.sockets.splice(idx, 1);
		
		(had_error ? console.error : console.log)("Connection with " +
												  remoteDesc + " closed.");
	});
	
	socket.on("data", function (packetData) {
		var packetOffset = 0;
		while (packetOffset < packetData.length) {
			//console.log("Decrypting with cipher key starting at " + socket.cipherInKey);	// debug
			
			// Determine the message's size.
			var fmt = "<l";
			packetOffset += bufferpack.calcLength(fmt);
			for (var i = 0; i < packetOffset; i++) {
				packetData[i] = decryptByte(packetData[i]);
			}
			var msgSize = parseInt(bufferpack.unpack(fmt, packetData), 10);
			
			// Decrypt the rest of the message.
			for (var i = packetOffset; i < packetOffset + msgSize; i++) {
				packetData[i] = decryptByte(packetData[i]);
			}
			//console.log(packetData);												// debug
			
			// Determine the message type.
			fmt = "<l";
			var typeId = bufferpack.unpack(fmt, packetData, packetOffset);
			packetOffset += bufferpack.calcLength(fmt);
			if (!(typeId in types.types)) {
				die(types.errors.general, typeId,
					"Unknown message type #" + typeId + ".");
				return;
			}
			socket.lastSendTime = new Date();
			var type = types.types[typeId];
			console.log("Received " + (type.name[0].isVowel() < 0 ? "a" : "an") +
						" “" + type.name + "” message from " + remoteDesc + ":");
			
			// Unpack the rest of the message.
			packetOffset += bufferpack.calcLength("x");
			var struct = new type();
			packetOffset += struct.unpack(packetData.slice(packetOffset)).length;
			console.log(struct);
			
			// Check sanity.
			if (struct.requiresVersion && !socket.version) {
				// Expected a version before anything else.
				die(types.errors.general, 0,
					"Must first perform version negotation by sending a “" +
					types.Version1.name + "” message.");
				return;
			}
			if (struct.requiresLogin && !socket.loggedIn) {
				// Expected a login before anything else.
				die(types.errors.general, 0,
					"Must first log in by sending a “" + types.Login3.name +
					"” message.");
				return;
			}
			
			// Handle the message.
			socket.emit(type.name, struct);
		}
	});
	
	/**
	 * @see case lsStartState in lsRemoteClientMsgCallback_() in lsRemoteClient.c
	 */
	socket.on("Version1", function (version) {
		socket.version = version;
		
		var prettyClientVersion = ((version.appVersion / 100) + "." +
								   (version.appVersion % 100));
		var prettyMinProtocolVersion = ((version.minVersion / 100) + "." +
										(version.minVersion % 100));
		if (version.minVersion[0] > config.protocolVersion[0] ||
			(version.minVersion[1] == config.protocolVersion[1] &&
			 version.minVersion[1] > config.protocolVersion[1])) {
			die(types.errors.general, 0,
				version.appName + " " + prettyClientVersion + " requires " +
				config.protocolName + " " + prettyMinProtocolVersion + "+.");
			return;
		}
		
		var prettyMaxProtocolVersion = ((version.version / 100) + "." +
										(version.version % 100));
		if (version.version[0] < config.protocolVersion[0] ||
			(version.version[1] == config.protocolVersion[1] &&
			 version.version[1] < config.protocolVersion[1])) {
			die(types.errors.general, 0,
				version.appName + " " + prettyClientVersion + " only supports " +
				config.protocolName + " " + prettyMaxProtocolVersion + ".");
			die(types.errors.general, 0, msg);
			return;
		}
		
		// LiveSpace Explorer 1 apparently has some security hole severe enough
		// that Atmo Collab Server 0.7 doesn't support the client at all.
		if (version.appName == "LiveSpace Explorer" && version.appVersion == 1) {
			die(types.errors.general, 0,
				"LiveSpace Explorer 0.1 is unsupported due to a security hole.");
			return;
		}
		
		// Acknowledge successful version negotation.
		socket.send(server.version, function () {
			console.log("Negotiated version successfully.");
		});
	});
	
	/**
	 * @see lsRemoteClientLogin() in lsRemoteClient.c
	 */
	socket.on("Login3", function (login) {
		// Require some identification.
		if ((!login.userName && !login.userId) || !login.password ||
			!login.clientIdent) {
			die(types.errors.login, 0, "Underspecified login request.");
			return;
		}
		
		// Prevent banned clients from logging in.
		if (login.clientIdent in config.bannedClientIdents) {
			die(types.errors.login, 0,
				"The client “" + login.clientIdent +
				"” has been banned from this server.");
			return;
		}
		
		// Authenticate the user.
		var user;
		for (var name in config.users) {
			var u = config.users[name];
			if (((login.userId && login.userId == u.userId) ||
				 (login.userName && login.userName == u.userName)) &&
				login.password == u.password) {
				user = u;
				break;
			}
		}
		if (!user) {
			var target = (login.userName ? ("“" + login.userName + "”") :
						  ("#" + login.userId));
			console.error("Client “" + login.clientIdent + "” tried to log in as " +
						  target + ".");
			die(types.errors.login, 0, "Invalid login.");
			return;
		}
		
		// Record the user's information.
		socket.userName = user.userName;
		socket.userId = user.userId;
		socket.url = login.url;
		socket.clientIdent = login.clientIdent;
		
		// TODO: lsRetrieveModeratorSettings() in lsWorld.c
		
		// Acknowledge the successful login.
		console.log("“" + socket.clientIdent + "” is logged in as “" +
					socket.userName + "” (#" + socket.userId + ") at <" +
					socket.url + ">.");
		socket.send(new types.LoginAck1({
			userName: socket.userName,
			userId: socket.userId,
			cid: socket.clientId,
		}), function () {
			console.assert(socket.userId);
			socket.loggedIn = true;
		});
	});
	
	/**
	 * @see lsServer_ObsCreate2() in lsServer.c
	 */
	socket.on("ObsCreate2", function (objects) {
		objects = new types.ObsCreate3(objects);
		
		// Check sanity.
		if (!objects.worldName) {
			die(types.errors.objectCreation, objects.cookie,
				"No world name specified when creating an object.");
			return;
		}
		
		console.log("Client #" + socket.clientId + " has asked to create " +
					objects.numObs + (objects.numObs == 1 ? " object" : " objects") +
					", owned by object #" + objects.owner + ", in world “" +
					objects.worldName + "” #" + objects.wiid + " (“" +
					objects.reference + "”).");
		
		// TODO: Slaves should delegate object creation to their masters and
		// propagate the changes locally.
		
		// Find the requested world.
		var world = server.getWorld(objects.worldName, objects.reference,
									objects.pageURL);
		if (!world) {
			die(types.errors.objectCreation, objects.cookie,
				"Failed to look up or create a world for " +
				(objects.numObs == 1 ? "this object" : "these objects") + ".");
			return;
		}
		
		// Add the requested objects to the world.
		try {
			world.addObjects(objects, socket, server);
		}
		catch (exc) {
			if (typeof(exc) == "string" || exc instanceof String) {
				die(types.errors.objectCreation, objects.cookie, exc);
			}
			else throw exc;
		}
	});
	
	/**
	 * @see lsRemoteClient_ObPosition() in lsRemoteClient.c
	 */
	socket.on("ObPosition1", function (position) {
		var obj = this.objects.find(function (obj, idx, arr) {
			return obj.id === position.oid;
		});
		if (!obj) {
			die(types.errors.objectPosition, position.oid,
				"Attempted to set the position of an object you do not own.");
		}
		obj.position = [position.pos.slice(0, 3), position.pos.slice(3, 6)];
		obj.markAsDirty(objectobserver.dirtyAttrsPosition);
		// TODO: broadcast
	});
	
	// Announce the client's presence to the sysop.
	console.log("Connected to client #" + socket.clientId + " at " +
				remoteDesc + ".");
});

server.on("close", function () {
	console.log("Server closed to new connections.");
});
