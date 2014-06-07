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
		// Delete symlink which may be pointing to wrong directory and will give false for FS.exists.
		try { FS.unlinkSync(linkPath); } catch(err) {}
		console.log("Linking npm package " + liveServicePath + " to " + linkPath);
		if (!FS.existsSync(PATH.dirname(linkPath))) {
			FS.mkdirSync(PATH.dirname(linkPath));
		}
		FS.symlinkSync(liveServicePath, linkPath);
	}
}
'

if [ -f Makefile ]; then
	make install
else
	# NOTE: Needed when running as root: `--unsafe-perm` see http://stackoverflow.com/a/19132229/330439
	npm install --production --unsafe-perm
fi
