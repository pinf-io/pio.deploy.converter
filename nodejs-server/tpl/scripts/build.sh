#!/bin/bash -e

# Link all npm modules that are declared and present in parent as service.
node --eval '
const PATH = require("path");
const FS = require("fs");
var config = JSON.parse(FS.readFileSync(process.env.PIO_CONFIG_PATH));
var descriptor = config.config["pio.service"].sourceDescriptor;
if (!descriptor.dependencies) process.exit(0);
for (var alias in descriptor.dependencies) {
	var liveServicePath = PATH.join(config.config["pio.vm"].prefixPath, "services", alias, "live/install");
	if (FS.existsSync(liveServicePath)) {
		var linkPath = PATH.join(process.env.PIO_SERVICE_PATH, "build/node_modules", alias);
		console.log("Linking " + liveServicePath + " to " + linkPath);
		if (!FS.existsSync(PATH.dirname(linkPath))) {
			FS.mkdirSync(PATH.dirname(linkPath));
		}
		FS.symlinkSync(liveServicePath, linkPath);
	}
}
'

npm install --production
