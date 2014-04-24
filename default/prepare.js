
module.exports = function(pio, state) {

	var defaults = {};
	if (state["pio.deploy.converter"]) {
		defaults = pio.API.DEEPCOPY(state["pio.deploy.converter"]);
	}

	return pio.API.Q.resolve({
		"pio.deploy.converter": {
			"sourcePath": defaults.sourcePath || "source",
			"scriptsPath": defaults.scriptsPath || "scripts"
		}
	});
}
