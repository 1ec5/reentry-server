///**
// * True to kill the server on fatal errors; false to keep going but kill
// * problematic connections.
// */
//exports.debug = true;

// Branding

/**
 * Server software name.
 */
exports.productName = "Reentry Server";

/**
 * Server software version in three components.
 * 
 * The first element is the major version number. The second is the two-digit
 * minor version number. The third element is not sent to clients.
 */
exports.productVersion = [0, 1, 1];

/**
 * Name of the software this software is based on. Factored out as a constant in
 * case trademark issues arise.
 */
exports.predecessorName = "Atmosphere Collaboration Server";

/**
 * @see lssAppVersion in lsServer.h
 */
exports.predecessorVersion = [7];

/**
 * Name of the protocol implemented by this software.
 * 
 * Called "LiveSpace Protocol" in lsTypes.h.
 */
exports.protocolName = "Yet Another Chat Protocol";

/**
 * Version of the protocol implemented by this software.
 * 
 * The first element is the major version number. The second is the two-digit
 * minor version number.
 * 
 * @see lsVersion in lsTypes.h
 */
exports.protocolVersion = [0, 5];

// Atmosphere Player build 67 = 0.3

// Users

/**
 * A dictionary mapping special users' internal names to their credentials.
 *
 * Each installation of the server should have unique values for each of these
 * credentials.
 * 
 * @see lsUsers.h
 */
exports.users = {
	slave: {userName: "__SLAVE__", userId: 1, password: "Jjda89$@#*j9"},
	god: {userName: "god", userId: 2, password: "tangent"},
	guest: {userName: "guest", userId: 100, password: "beta"},
};

/**
 * An array of client identities banned from the server.
 * 
 * Client identity strings are somehow unique to each installation of the client
 * software.
 * 
 * @see lsClientInfoStruct in lsClientInfo.h
 */
exports.bannedClientIdents = [];

// Connections

/**
 * Number of seconds of inactivity before a connection to a master server is
 * shut.
 * 
 * @see lssInactivityTimeoutMaster in lsServer.h
 */
exports.masterInactivityTimeout = 1 /* h */ * 60 /* min/h */ * 60 /* s/min */;

/**
 * Number of seconds of inactivity before a connection to a slave server is
 * shut.
 * 
 * @see lssInactivityTimeoutSlave in lsServer.h
 */
exports.slaveInactivityTimeout = 2 /* h */ * 60 /* min/h */ * 60 /* s/min */;

// Encryption
// The server's "encryption" scheme is nothing more than an XOR cipher using
// sent and received data as realtime keys.

/**
 * The initial value of the XOR cipher's key.
 * 
 * Modifying this arbitrary constant will break existing clients.
 * 
 * @see encryptInInit in lcRawSmartCon.c
 */
exports.cipherSeed = 78;

// Objects

/**
 * @see lssMaxObsPerCreate in lsServer.h
 */
exports.maxObjectsCreatedSimultaneously = 10;

/**
 * @see lsServerCreate() in lsServer.c
 */
exports.maxClients = 1000;

// Worlds

/**
 * Number of milliseconds to cache recent transitions for.
 * 
 * @see recentTransitionWindow in lsWorld.c
 */
exports.transitionExpiry = 1 /* min */ * 60 /* s/min */ * 1000 /* ms/s */;

/**
 * Common URL prefix of all the simple avatars.
 *
 * @see avStem in lsTranslateAv() in lsWorld.c
 */
exports.simpleAvatarUrlPrefix =
	"http://www.adobe.com/products/atmosphere/avatars/default/default";
exports.numSimpleAvatars = 20;
