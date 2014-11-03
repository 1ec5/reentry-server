Reentry Server
==============

[![Dependencies](https://david-dm.org/1ec5/reentry-server.png)](https://david-dm.org/1ec5/reentry-server)

Years after the plug was pulled on [Atmosphere](https://en.wikipedia.org/wiki/Adobe_Atmosphere) and its official chat server, the zombies are back! Witness 3D worlds come alive again with **Reentry Server**, a work-in-progress implementation of the **Yet Another Chat Protocol** (YACP) version 0.5. Powered by [Node.js](http://nodejs.org/), this modern rewrite of the open source Atmosphere Collaboration Server 7 will eventually make it easy for world builders to host their own chat rooms.

Progress
--------

At the moment, Reentry Server only supports the most basic scenarios for interacting with the Atmosphere Community Server test client:

* moving around a world
* basic chat
* `/avatar`
* `/goto`
* `/nick`
* whispering

Sundry moderator slash-commands have been stubbed out but probably don’t work at all.

Usage
-----

Getting started couldn’t be simpler:

1. [Download and install Node.js](http://nodejs.org).
1. In a shell, run `npm install -g reentry-server` to install Reentry Server globally. (If you don’t want to host the server yourself, free and paid Node.js hosting is available from [a number of providers](https://github.com/joyent/node/wiki/Node-Hosting).)
1. Start the server with either `yacpd` or `reentry-server`.

The server can host chats in any .aer world created with Adobe Atmosphere. By default, Atmosphere sets a world’s chat server to <yacp://atmosphere.adobe.com>, which is no longer active. However, you can customize it to the address of your running Reentry Server or instruct users to map atmosphere.adobe.com to your hostname [in their hosts file](http://www.jfdhobbies.com/AtmoTutorials.html).

Users can connect to the server with any version of LiveSpace Explorer (except version 0.1), 3D Anarchy, or Adobe Atmosphere. [Build 212d](ftp://ftp.adobe.com/pub/adobe/atmosphere/win/2.x/) of the Adobe Atmosphere plugin is recommended.

Credit
------

Obviously, this project owes its existence to the Adobe Atmosphere team and the code they released under a generous, open source license. Credit is also due to Ryan Olds for his [bufferpack module](https://github.com/ryanrolds/bufferpack), and to the ragtag band of Atmosphere fans for their unwavering dedication to an awesome piece of abandonware.

Atmosphere is a registered trademark of Adobe Systems Incorporated.
