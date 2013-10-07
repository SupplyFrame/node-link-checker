#!/usr/bin/env node

var path = require('path');
var check = require('./index.js');

var program = require('commander');

var packageJSON = require('./package.json');

program.version(packageJSON.version)
	.option('-t, --type [type]', 'Document type must be one of `pdf`, `zip`, `jpeg`, `gif` or `png`. [pdf]', 'pdf')
	.option('-f, --format [format]', 'Set output format, valid options are `json` and `plain`. [json]', 'json')
	.option('-v, --verbose', 'Show verbose output in plaintext. [false]', false)
	.usage('[options] <url>');

program.parse(process.argv);

if (program.args.length < 1) {
	console.log('You must specify a url to check');
	process.exit(-1);
}

var url = program.args[0];

if (!check.fileTypes[program.type]) {
	console.log('Unknown filetype specified : '  + program.type);
	process.exit(-1);
}

if (program.verbose && program.format==='plain') {
	console.log('Checking url ' + url + ' for filetype ' + program.type);
}

var fileType = check.fileTypes[program.type];
check.check(url, fileType, function(err, result) {
	if (err) {
		console.log(JSON.stringify({error: err}));
		return process.exit(-1);
	}
	if (program.format==='plain') {
		console.log('Url: ' + result.original);
		console.log('Final Url: ' + result.actual);
		console.log('Matched: ' + result.matched);
		if (program.verbose) {
			console.log('Redirects: ' + ((result.redirects.length > 0) ? result.redirects.join(', ') : 'none'));
			console.log('Filetype: ' + result.matchedType);
		}
	} else if (program.format==='json') {
		console.log(JSON.stringify(result));
	}
	
	process.exit(1);
});