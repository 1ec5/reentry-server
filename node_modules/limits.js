// Since the Atmosphere Collaboration Server and client were both compiled for
// 32-bit systems, this module reflects the typical limits.h constants for such
// a system.

//* @see UCHAR_MAX in limits.h
exports.maxUChar = 255;

//* @see INT_MAX in limits.h
exports.maxInt = 2147483647;

//* @see INT_MIN in limits.h
exports.minInt = -1 * (exports.maxInt + 1);
