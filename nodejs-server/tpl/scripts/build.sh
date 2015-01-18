#!/bin/bash -e

# Link all npm modules that are declared and present in parent as service.
node --eval '
const PATH = require("path");
const FS = require("fs");
var config = JSON.parse(FS.readFileSync(process.env.PIO_CONFIG_PATH));
var descriptor = config.config["pio.service"].sourceDescriptor;
if (!descriptor.dependencies) process.exit(0);

function linkCommands(alias) {
    var descriptorPath = PATH.join(process.env.PIO_SERVICE_PATH, "build/node_modules", alias, "package.json");
    var binBasePath = PATH.join(process.env.PIO_SERVICE_PATH, "build/node_modules/.bin");
    var descriptor = JSON.parse(FS.readFileSync(descriptorPath));
    if (!descriptor.bin) {
        return;
    }
    for (var command in descriptor.bin) {

        var linkPath = PATH.join(binBasePath, command);
        var fromPath = PATH.join(descriptorPath, "..", descriptor.bin[command]);

        console.log("Linking " + fromPath + " to " + linkPath + ".");

        if (!FS.existsSync(linkPath)) {
            if (!FS.existsSync(fromPath)) {
                return callback(new Error("Command declared as " + command + " in " + descriptorPath + " not found at " + fromPath + "!"));
            }
            if (!FS.existsSync(PATH.dirname(linkPath))) {
                FS.mkdirSync(PATH.dirname(linkPath));
            } else {
                // Replace symlink if it exists.
                try {
                    FS.unlinkSync(linkPath);
                } catch(err) {}
            }
            FS.symlinkSync(PATH.relative(PATH.dirname(linkPath), fromPath), linkPath);
        }
    }
}

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
		linkCommands(alias);
	}
}
'

if [ -f bin/install.sh ]; then
    bin/install.sh
elif [ -f Makefile ]; then
    make install
else
    # NOTE: Needed when running as root: `--unsafe-perm` see http://stackoverflow.com/a/19132229/330439
    npm install --production --unsafe-perm
fi
