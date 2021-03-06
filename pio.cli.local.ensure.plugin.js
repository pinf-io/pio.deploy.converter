
const ASSERT = require("assert");
const PATH = require("path");
const FS = require("fs-extra");
const Q = require("q");
const CRYPTO = require("crypto");
const EXEC = require("child_process").exec;
const NCP = require("ncp");


exports.ensure = function(pio, state) {

    return pio.API.Q.fcall(function() {

        var converterDescriptor = {};
        var serviceDescriptor = {};

        if (!state["pio.service"]) {
            // We don't have a service context so this module needs to do nothing.
            return {};
        }

        ASSERT.equal(typeof state["pio.service"].path, "string", "'state[pio.service].path' must be set to a string!");
        ASSERT.equal(typeof state["pio.deploy"].isSynced, "function", "'state[pio.deploy].isSynced' must be set to a function!");

        var targetBasePath = PATH.join(pio._configPath, "..", ".pio.sync", state["pio.service"].id);
        var targetSourcePath = PATH.join(targetBasePath, "source");
        var targetScriptsPath = PATH.join(targetBasePath, "scripts");

        function formatResponse() {

            converterDescriptor.before = {
                "pio.service": {
                    path: state["pio.service"].path
                }
            };
            serviceDescriptor.path = targetBasePath;

            return {
                "pio.deploy.converter": converterDescriptor,
                "pio.service": serviceDescriptor
            };
        }

        if (state["pio.deploy"].isSynced(state)) {
            if (state["pio.cli.local"].force) {
                console.log(("Skip convert service '" + state["pio.service"].id + "'. It has not changed. BUT CONTINUE due to 'state[pio.cli.local].force'").yellow);
            } else {
                var convertedDescriptorPath = PATH.join(targetBasePath, ".pio.json");

                if (!FS.existsSync(convertedDescriptorPath)) {
                    if (state["pio.cli.local"].verbose) {
                        console.log("Converted descriptor not found thus we convert the service ...".yellow);
                    }
                } else {
                    var convertedDescriptor = FS.readJsonSync(convertedDescriptorPath);
                    serviceDescriptor.finalChecksum = convertedDescriptor.config["pio.service"].finalChecksum;
                    converterDescriptor.didConvert = false;

                    if (state["pio.cli.local"].verbose) {
                        console.log("Final checksum after skipped conversion: " + serviceDescriptor.finalChecksum);
                    }

                    return formatResponse();
                }
            }
        }

        var converterName = (
            state["pio.deploy.converter"] &&
            state["pio.deploy.converter"].name
        ) || "default";

        var defaultConverterPath = PATH.join(__dirname, "default");

        function getConverterPath() {
            return Q.fcall(function() {
                var converterPath = null;
                var converterNameParts = converterName.split("/");
                if (pio._locatedServices[converterNameParts[0]]) {
                    converterPath = PATH.join(pio._locatedServices[converterNameParts[0]], converterNameParts.slice(1).join("/"));
                } else {
                    converterPath = PATH.join(__dirname, converterName);
                }
                if (!FS.existsSync(converterPath)) {
                    throw new Error("pio.deploy.converter '" + converterName + "' not found at path: " + converterPath);
                }
                return converterPath;
            });
        }

        return getConverterPath().then(function(converterPath) {

            var converterResponse = null;

            function prepare() {
                return require(PATH.join(converterPath, "prepare.js"))(pio, state).then(function(response) {
                    converterResponse = response;
                    converterDescriptor = pio.API.DEEPMERGE(converterDescriptor, response["pio.deploy.converter"] || {});
                });
            }

            return prepare().then(function() {

                ASSERT.notEqual(typeof converterDescriptor.sourcePath, "undefined", "'state[pio.deploy.converter].sourcePath' must be set!");
                ASSERT.notEqual(typeof converterDescriptor.scriptsPath, "undefined", "'state[pio.deploy.converter].scriptsPath' must be set!");

                if (state["pio.cli.local"].verbose) {
                    console.log(("Converting package using: " + converterPath).magenta);
                }

                // TODO: Because we are adding assets to the package here we need to track these and add them to the checksum.
                //       Also we need to add source file paths for this converter module to the dependency history so that if any
                //       of the code files change we can ask system to re-generate conversion target and then compare to finalChecksum.
                // WORKAROUND: If converter code is changed force a conversion and deploy with: `pio deploy`

                function prepareTarget() {
                    if (state["pio.cli.local"].verbose) {
                        console.log("Prepare target");
                    }
                    return Q.denodeify(function(callback) {
                        return FS.exists(targetBasePath, function(exists) {
                            if (!exists) {
                                return callback(null);
                            }
                            return Q.denodeify(function(callback) {
                                return EXEC('chmod -Rf u+w ' + PATH.basename(targetBasePath), {
                                    cwd: PATH.dirname(targetBasePath)
                                }, function(err, stdout, stderr) {
                                    if (err) {
                                        console.error(stdout);
                                        console.error(stderr);
                                        return callback(err);
                                    }
                                    return callback(null);
                                });
                            })().then(function() {
                                return FS.remove(targetBasePath, callback);
                            });
                        });
                    })();
                }

                function copySource() {
                    if (state["pio.cli.local"].verbose) {
                        console.log("Copy source");
                    }
                    if (!converterDescriptor.sourcePath) {
                        if (state["pio.cli.local"].verbose) {
                            console.log("No source path declared!");
                        }
                        return Q.denodeify(FS.mkdirs)(targetSourcePath);
                    }
                    return Q.denodeify(function(callback) {
                        if (state["pio.cli.local"].verbose) {
                            console.log("targetSourcePath", targetSourcePath);
                        }
                        return FS.mkdirs(targetSourcePath, function(err) {
                            if (err) return callback(err);
                            var sourcePath = FS.realpathSync(PATH.join(state["pio.service"].path, converterDescriptor.sourcePath));
                            if (state["pio.cli.local"].verbose) {
                                console.log("sourcePath", sourcePath);
                            }
                            return FS.exists(sourcePath, function(exists) {
                                if (!exists) {
                                    return callback(null);
                                }
                                var walker = new pio.API.FSWALKER.Walker(sourcePath);
                                var opts = {};
                                opts.returnIgnoredFiles = false;
                                opts.includeDependencies = false;
                                opts.respectDistignore = true;
                                opts.respectNestedIgnore = true;
                                opts.excludeMtime = true;
                                return walker.walk(opts, function(err, fileinfo) {
                                    if (err) return callback(err);
                                    var sourcePathLength = sourcePath.length;
                                    return NCP(sourcePath, targetSourcePath, {
                                        stopOnErr: true,
                                        filter: function(filepath) {
                                            var path = filepath.substring(sourcePathLength);
                                            if (!path) return true;
                                            return (!!fileinfo[path]);
                                        }
                                    }, function (err) {
                                        if (err) {
                                            // TODO: Make sure error is formatted correctly.
                                            console.error("ERR", err);
                                            return callback(err);
                                        }
                                        var path = PATH.join(targetSourcePath, ".pio.filelist");
                                        if (state["pio.cli.local"].verbose) {
                                            console.log("Writing filelist to: ", path);
                                        }
                                        return FS.outputFile(path, JSON.stringify(fileinfo, null, 4), callback);
                                    });
                                });
                            });
                        });
                    })().then(function() {

                        var all = [];

                        // TODO: Make this more generic based on more meta data.
                        //       Should be able to specifically control which parts of the package descriptor to override.
                        if (state["pio.service"].mappings) {
                            var path = PATH.join(targetSourcePath, "package.1.json");
                            if (state["pio.cli.local"].verbose) {
                                console.log("Writing package descriptor overlay to: ", path);
                            }
                            all.push(Q.denodeify(FS.outputFile)(path, JSON.stringify({
                                mappings: state["pio.service"].mappings
                            }, null, 4)));
                        }
                        // TODO: Make this more generic based on more meta data.
                        //       Should be able to specifically control which parts of the package descriptor to override.
                        if (state["pio.service"]["./package.json"]) {
                            var path = PATH.join(targetSourcePath, "package.json");
                            all.push(Q.denodeify(function(callback) {
                                return FS.exists(path, function(exists) {
                                    if (!exists) return callback(null);
                                    return FS.readJson(path, function(err, descriptor) {
                                        if (err) return callback(err);
                                        descriptor = pio.API.DEEPMERGE(descriptor || {}, state["pio.service"]["./package.json"]);
                                        if (state["pio.cli.local"].verbose) {
                                            console.log("Updating package descriptor at: ", path);
                                        }
                                        return FS.outputFile(path, JSON.stringify(descriptor, null, 4), callback);
                                    });
                                });
                            })());
                        }

                        return Q.all(all);
                    });
                }

                function copyScripts() {
                    if (state["pio.cli.local"].verbose) {
                        console.log("Copy scripts");
                    }
                    return Q.denodeify(function(callback) {
                        if (!converterDescriptor.scriptsPath) {
                            return callback(null);
                        }
                        if (state["pio.cli.local"].verbose) {
                            console.log("targetScriptsPath", targetScriptsPath);
                        }
                        return FS.mkdirs(targetScriptsPath, function(err) {
                            if (err) return callback(err);
                            return FS.realpath(PATH.join(state["pio.service"].path, converterDescriptor.scriptsPath), function(err, scriptsPath) {
                                if (err) {
                                    if (err.code === "ENOENT") {
                                        if (state["pio.cli.local"].verbose) {
                                            console.log("Skip copy scripts as path not found: " + PATH.join(state["pio.service"].path, converterDescriptor.scriptsPath));
                                        }
                                        return callback(null);
                                    }
                                    return callback(err);
                                }
                                if (state["pio.cli.local"].verbose) {
                                    console.log("scriptsPath", scriptsPath);
                                }
                                return FS.exists(scriptsPath, function(exists) {
                                    if (!exists) {
                                        return callback(null);
                                    }
                                    var walker = new pio.API.FSWALKER.Walker(scriptsPath);
                                    var opts = {};
                                    opts.returnIgnoredFiles = false;
                                    opts.includeDependencies = false;
                                    opts.respectDistignore = true;
                                    opts.respectNestedIgnore = true;
                                    opts.excludeMtime = true;
                                    return walker.walk(opts, function(err, fileinfo) {
                                        if (err) return callback(err);
                                        var scriptsPathLength = scriptsPath.length;
                                        return NCP(scriptsPath, targetScriptsPath, {
                                            stopOnErr: true,
                                            filter: function(filepath) {
                                                function check() {
                                                    var path = filepath.substring(scriptsPathLength);
                                                    if (!path) return true;
                                                    return (!!fileinfo[path]);
                                                }
                                                if (check()) {
                                                    if (state["pio.cli.local"].verbose) {
                                                        console.log("Copy file: ", filepath);
                                                    }
                                                    return true;
                                                }
                                                return false;
                                            }
                                        }, function (err) {
                                            if (err) {
                                                // TODO: Make sure error is formatted correctly.
                                                console.error("ERR", err);
                                                return callback(err);
                                            }
                                            var path = PATH.join(targetScriptsPath, ".pio.filelist");
                                            if (state["pio.cli.local"].verbose) {
                                                console.log("Writing filelist to: ", path);
                                            }
                                            return FS.outputFile(path, JSON.stringify(fileinfo, null, 4), callback);
                                        });
                                    });
                                });
                            });
                        });
                    })();
                }

                function copyFromTemplate() {
                    // NOTE: This resolves all symlinks which is what we want.
                    return Q.denodeify(walk)(PATH.join(defaultConverterPath, "tpl")).then(function(filelist) {
                        function copyFile(path) {                    
                            return Q.denodeify(function(callback) {
                                var targetPath = PATH.join(targetBasePath, path);
                                return FS.exists(targetPath, function(exists) {
                                    if (exists) {
                                        return callback(null);
                                    }
                                    var templatePath = PATH.join(converterPath, "tpl", path);
                                    return FS.exists(templatePath, function(exists) {
                                        if (!exists) {
                                            templatePath = PATH.join(defaultConverterPath, "tpl", path);
                                        }
                                        if (state["pio.cli.local"].verbose) {
                                            console.log("Copy", templatePath, "to", targetPath);
                                        }
                                        return FS.readFile(templatePath, "utf8", function(err, templateSource) {
                                            if (err) return callback(err);
                                            return FS.outputFile(targetPath, templateSource, "utf8", callback);
                                        });
                                    });
                                });
                            })();
                        }
                        var all = [];
                        filelist.forEach(function(path) {
                            all.push(copyFile(path));   
                        });
                        return Q.all(all);
                    });
                }

                return prepareTarget().then(function() {
                    return copySource();
                }).then(function() {
                    return copyScripts().then(function() {
                        return copyFromTemplate();
                    });
                }).then(function() {

                    return Q.denodeify(function(callback) {
                        return EXEC([
                            'chmod -Rf 0744 *',
                            'chmod -Rf u+x scripts/*'
                        ].join("\n"), {
                            cwd: targetBasePath
                        }, function(err, stdout, stderr) {
                            if (err) {
                                console.error(stdout);
                                console.error(stderr);
                                return callback(err);
                            }
                            return callback(null);
                        });
                    })();

                }).then(function() {

                    function generateFileInfo() {
                        var walker = new pio.API.FSWALKER.Walker(targetBasePath);
                        var opts = {};
                        opts.returnIgnoredFiles = true;
                        opts.includeDependencies = true;
                        opts.respectDistignore = false;
                        opts.respectNestedIgnore = false;
                        opts.excludeMtime = true;
                        return pio.API.Q.nbind(walker.walk, walker)(opts).then(function(fileinfo) {
                            var shasum = CRYPTO.createHash("sha1");
                            shasum.update(JSON.stringify(fileinfo[0]));
                            return {
                                checksum: shasum.digest("hex"),
                                fileinfo: fileinfo
                            };
                        });
                    }
                    return generateFileInfo().then(function(fileInfo) {
                        // Update checksum based on all exported files.
                        serviceDescriptor.finalChecksum = fileInfo.checksum;
                        if (state["pio.cli.local"].verbose) {
                            console.log("Updated checksum after convert to: " + serviceDescriptor.finalChecksum);
                        }
                    });

                }).then(function() {

                    converterDescriptor.didConvert = true;

                    return formatResponse();
                }).then(function(response) {
    
                    var pioDescriptor = pio.API.DEEPMERGE({
                        config: state
                    }, {
                        config: response
                    });
    
                    function convertState(state) {
                        if (typeof converterResponse["pio.deploy.converter"].convertState !== "function") {
                            return pio.API.Q.resolve(state);
                        }
                        return converterResponse["pio.deploy.converter"].convertState(state);
                    }

                    return convertState(response).then(function(response) {

                        // NOTE: We write the descriptor here but it gets written again on deploy.
                        // TODO: On deploy we should not be doing anything that we cannot already do here.
                        //       If deploy needs to add more data it should write a second descriptor.
                        FS.outputFileSync(PATH.join(serviceDescriptor.path, ".pio.json"), JSON.stringify(pioDescriptor, null, 4));

                        return response;
                    });
                });
            });
        });
    });
}


// @source http://stackoverflow.com/a/5827895/330439
var walk = function(dir, subpath, done) {
    if (typeof subpath === "function" && typeof done === "undefined") {
        done = subpath;
        subpath = null;
    }
  var results = [];
  subpath = subpath || "";
  FS.readdir(dir + subpath, function(err, list) {
    if (err) return done(err);
    var pending = list.length;
    if (!pending) return done(null, results);
    list.forEach(function(filename) {
      var path = subpath + '/' + filename;
      FS.stat(dir + path, function(err, stat) {
        if (stat && stat.isDirectory()) {
          walk(dir, path, function(err, res) {
            results = results.concat(res);
            if (!--pending) done(null, results);
          });
        } else {
          results.push(path);
          if (!--pending) done(null, results);
        }
      });
    });
  });
};
