
module.exports = function(pio, state) {

	var Res = function (properties) {
		for (var name in properties) {
			this[name] = properties[name];
		}
	}
	Res.prototype.convertState = function(_state) {
		if (
			state["pio.service"].sourceDescriptor.bin &&
			(
				typeof state["pio.service"].descriptor.bin === "undefined" ||
				Object.keys(state["pio.service"].descriptor.bin).length === 0
			)
		) {
			_state["pio.service"].descriptor = {
				bin: {}
			};
			for (var name in state["pio.service"].sourceDescriptor.bin) {
				_state["pio.service"].descriptor.bin[name] = "bin/" + name;
			}
		}
		return pio.API.Q.resolve(_state);
	}

	var defaults = {};
	if (state["pio.deploy.converter"]) {
		defaults = pio.API.DEEPCOPY(state["pio.deploy.converter"]);
	}

	return pio.API.Q.resolve({
		"pio.deploy.converter": new Res({
			"sourcePath": defaults.sourcePath || ".",
			"scriptsPath": defaults.scriptsPath || null
		})
	});
}
