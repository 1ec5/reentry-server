const config = require("./config");
const types = require("./types");

exports.dirtyAttrsPosition = 1 << 0;
exports.dirtyAttrsAvatar = 1 << 1;
exports.dirtyAttrsNickname = 1 << 2;
exports.numDirtyAttrs = 3;
exports.dirtyAttrsAll = (1 << exports.numDirtyAttrs) - 1;

/**
 * @see lsObObserverCreate() in lsObObserver.c
 */
function ObjectObserver(object, socket) {
	this.object = object;	// ob
	this.socket = socket;	// lsc
	this.numInstances = 1;	// reps
	this.dirty = exports.dirtyAttrsAll;
	
	if (!object.avatarUrl) this.dirty &= ~exports.dirtyAttrsAvatar;
	if (!object.nickname) this.dirty &= ~exports.dirtyAttrsNickname;
	if (!object.position[0][0] && !object.position[0][1] && !object.position[0][2] &&
		!object.position[1][0] && !object.position[1][1] && !object.position[1][2]) {
		this.dirty &= ~exports.dirtyAttrsPosition;
	}
	
	socket.observers.push(this);
	if (this.dirty) socket.dirtyObservers.push(this);
	object.observers.push(this);
}

/**
 * @see lsTranslateAv() in lsWorld.c
 */
ObjectObserver.prototype.filteredAvatarUrl = function () {
	var proxy = this.object.proxy;
	if (!proxy.clientIdent || proxy.ignoredIds.has(proxy.clientIdent)) {
		return "";
	}
	
	// unapproved(), approved()
	var url = this.object.avatarUrl;
	var worldInstance = this.object.worldInstance;
	var world = worldInstance.world;
	var approvedAvatars = world.approvedAvatars;
	if (approvedAvatars.length && approvedAvatars.indexOf(url) < 0) {
		if (world.defaultAvatar) return world.defaultAvatar;
		
		var approvedId = this.object.approvedAvatarId;
		if (approvedAvatars[approvedAvatarId]) {
			return approvedAvatars[approvedAvatarId];
		}
		
		var nextId = worldInstance.nextApprovedAvatarId;
		if (approvedAvatars[nextId]) {
			worldInstance.nextApprovedAvatarId++;
			this.object.approvedAvatarId = nextId;
			return approvedAvatars[nextId];
		}
		
		worldInstance.nextApprovedAvatarId = 1;
		this.object.approvedAvatarId = 0;
		return approvedAvatars[0];
	}
	
	var socket = this.socket;
	if (!socket.simpleAvatars || url.startsWith(config.simpleAvatarUrlPrefix)) {
		return url;
	}
	
	var idStr = ("0" + socket.nextSimpleAvatarId).substr(-2);
	url = config.simpleAvatarUrlPrefix + idStr + "/default" + idStr + ".aer";
	if (++socket.nextSimpleAvatarId == config.numSimpleAvatars) {
		socket.nextSimpleAvatarId = 1;
	}
	return url;
};

/**
 * @see lsTranslateNickname() in lsWorld.c
 */
ObjectObserver.prototype.filteredNickname = function () {
	var obj = this.object;
	var nickname = obj.nickname;
	if (obj.isSquelched) nickname = "[squelched]";
	else if (this.socket.ignoredIds.has(obj.proxy.clientIdent)) {
		nickname = "[ignored]";
	}
	if (this.socket.showIdents) {
		var suffix = "[" + obj.id + "]";
		nickname = nickname.substr(0, types.MAX_NICK_SIZE - suffix.length) + suffix;
	}
	return nickname;
};

/**
 * @see lsObObserverUpdateClient() in lsRemoteClient.c
 */
ObjectObserver.prototype.flushUpdates = function () {
	if (this.dirty & exports.dirtyAttrsPosition) {
		var position = this.object.position;
		this.socket.send(new types.ObPosition1({
			oid: this.object.id,
			pos: position[0].concat(position[1]),
		}));
	}
	if (this.dirty & exports.dirtyAttrsAvatar) {
		this.socket.send(new types.ObAvatar1({
			oid: this.object.id,
			url: this.filteredAvatarUrl(),
		}));
	}
	if (this.dirty & exports.dirtyAttrsNickname) {
		this.socket.send(new types.ObNickname1({
			oid: this.object.id,
			nickname: this.filteredNickname(),
		}));
	}
	this.dirty = 0;
};

/**
 * @see lsObObserverDirty() in lsObObserver_.h
 */
ObjectObserver.prototype.markAsDirty = function (attrs) {
	if (this.dirty) this.dirty |= attrs;
	else if ((this.dirty = attrs)) this.socket.dirtyObservers.push(this);
};

exports.ObjectObserver = ObjectObserver;
