Reentry Server
==============

Years after the plug was pulled on [Atmosphere](http://www.adobe.com/products/atmosphere/) and its official chat server, the zombies are back! Witness 3D worlds come alive again with **Reentry Server**, a work-in-progress implementation of the **Yet Another Chat Protocol** (YACP) version 0.5. Powered by [Node.js](http://nodejs.org/), this modern rewrite of the open source Atmosphere Collaboration Server 7 will eventually make it easy for world builders to host their own chat rooms.

Progress
--------

At the moment, Reentry Server only supports the most basic scenario for interacting with the Atmosphere Community Server test client. To wit, a user can enter a world. That’s it. Multiple users aren’t notified of others in the same world yet, and chat messages are still unimplemented.

Running Reentry Server
----------------------

Getting started couldn’t be simpler:

1. [Download and install Node.js](http://nodejs.org). Free and paid Node.js hosting is available from [a number of providers](https://github.com/joyent/node/wiki/Node-Hosting).
1. [Download and unzip Reentry Server](https://github.com/1ec5/reentry-server/downloads) into a directory anywhere on the system.
1. In a shell, go to that directory and execute the following commands on the command line:
```bash
npm link
reentry-server
```

Credit
------

Obviously, this project owes its existence to the Adobe Atmosphere team and the code they released under a generous, open source license. Credit is also due to Ryan Olds for his [bufferpack module](https://github.com/ryanrolds/bufferpack), and to the ragtag band of Atmosphere fans for their unwavering dedication to an awesome piece of abandonware.

Atmosphere is a registered trademark of Adobe Systems Incorporated.
