var request = require('request'),
	url = require('url'),
	fs = require('fs'),
	temp = require('temp'),
	path = require('path'),
	util = require('util');

var fileTypes = {
	'pdf': [{
		bytes: [0x25, 0x50, 0x44, 0x46],
		name: 'pdf'
	}],
	'jpeg': [{
		bytes: [0xFF, 0xD8],
		name: 'jpeg'
	}],
	'gif': [{
		bytes: [0x47, 0x49, 0x46, 0x38, 0x37, 0x61],
		name: 'gif87a'
	},{
		bytes: [0x47, 0x49, 0x46, 0x38, 0x39, 0x61],
		name: 'gif89a'
	}],
	'png': [{
		bytes: [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A],
		name: 'png'
	}],
	'zip': [{
		bytes: [0x1f, 0x8B, 0x08],
		name: 'gzip'
	},{
		bytes: [0x37, 0x7A, 0xBC, 0xAF, 0x27, 0x1C],
		name: '7zip'
	},{
		bytes: [0x50, 0x4B, 0x03, 0x04],
		name: 'zip'
	},{
		bytes: [0x57, 0x69, 0x6E, 0x5A, 0x69, 0x70],
		offsetBytes: 29152,
		name: 'winzip'
	}],
	'rar': [{
		bytes: [0x52, 0x61, 0x72, 0x21, 0x1A, 0x07, 0x00],
		name: 'rar1.x'
	},{
		bytes: [0x52, 0x61, 0x72, 0x21, 0x1A, 0x07, 0x01, 0x00],
		name: 'rar5.x'
	}]
};
module.exports.getType = function(buffer) {
	var matched = false;
	for (var typeName in fileTypes) {
		var fileType = fileTypes[typeName];
		fileType.forEach(function(type) {
			var matching = true,
				byteIndex = type.offsetBytes || 0,
				ignoreBytes = type.ignoreBytes || [],
				k = 0,
				byteLen = byteIndex + type.bytes.length;

			for (; byteIndex < byteLen && k < type.bytes.length; byteIndex++, k++) {

				if (ignoreBytes.indexOf(k)!==-1) {
					continue; // skip ignore byte
				}
				if (buffer[byteIndex] !== type.bytes[k]) {
					matching = false;
					break;
				}
			}
			if (matching) {
				matched = true;
				return;
			}
		});
		if (matched) {
			return typeName;
		}
	}

	return false;
};
function checkUrl(requestUrl, fileType, callback, recurseCount, result) {
	if (recurseCount===undefined) {
		recurseCount = 0;
	} else if (recurseCount == 5) {
		return callback('redirect limit reached', result);
	}
	if (!fileType) {
		return callback('must specify filetype object', result);
	}
	if (!util.isArray(fileType)) {
		fileType = [fileType];
	}

	var buffer = null, readBytes = 0, requiredBytes = 0;
	if (result===undefined) {
		result = {
			original: requestUrl,
			actual: requestUrl,
			redirects: [],
			body: null,
			response: null,
			fileType: fileType,
			matched: false,
			matchedType: null
		};
	}
	// create buffer for storing data, at least large enough to store all offset bytes plus magic bytes
	// calculate largest byte length for all types in fileType array
	for (var i=0; i < fileType.length; i++) {
		var type = fileType[i];
		var size = (type.offsetBytes || 0) + type.bytes.length;
		requiredBytes = Math.max(requiredBytes, size);
	}
	buffer = new Buffer(requiredBytes);

	temp.track();
	temp.open({prefix:'node-link-checker-'}, function(err, info) {
  		fs.closeSync(info.fd);
		// load the url
		var r = request({
			'method':'GET',
			'uri': requestUrl
		}, function(err, response, body) {
			if (err) {
				callback(err, result);
			} else {
				// append any redirects we've encountered thus far
				for (var i=0; i < r.redirects.length; i++) {
					var redirect = {
						url: r.redirects[i].redirectUri,
						statusCode: r.redirects[i].statusCode,
						redirectType: 'http'
					};
					result.redirects.push(redirect);
				}

				var finalUrl = requestUrl;
				if (r.redirects && r.redirects.length > 0) {
					finalUrl = r.redirects[r.redirects.length-1].redirectUri;	
				}
				var parsedUrl = url.parse(finalUrl);
				var suffix = path.extname(parsedUrl.pathname);
				result.extension = suffix;

				fs.renameSync(info.path, info.path + suffix);
				result.tempPath = info.path+suffix;

				// attempt to find meta refresh redirect in body text
				var re = /meta.+?http-equiv\W+?refresh/i;
				var regexMatch = body.match(re);
				if (regexMatch) {
					re = /content.+?url\W+?(.+?)\"/i;
					var matches = body.match(re);
					if (matches.length >= 2) {
						var newUrl = matches[1];
						// resolve the url
						var resolved = url.resolve(requestUrl, newUrl);
						var redirect = {
							url: resolved,
							statusCode: response.statusCode,
							redirectType: 'meta'
						}
						result.redirects.push(redirect);
						// restart process!
						return checkUrl(resolved, fileType, callback, ++recurseCount, result);
					}
				}
				// failed to find a proper redirect
				// return full page to request object so they can do what they want with it
				result.body = body;
				result.response = response;
				return callback(null, result);
			}
		});
		var fileData = [];
	
  		r.pipe(fs.createWriteStream(info.path));

  		r.on('data', function(chunk) {
			var readyBytes = Math.min(chunk.length, requiredBytes-readBytes);
			chunk.copy(buffer, readBytes, 0, readyBytes);
			readBytes += readyBytes;

			if (readBytes>=requiredBytes) {
				// read enough bytes! do the check
				for (var i=0; i < fileType.length; i++) {
					var type = fileType[i],
						matching = true,
						byteIndex = type.offsetBytes || 0,
						ignoreBytes = type.ignoreBytes || [],
						k = 0,
						byteLen = byteIndex + type.bytes.length;

					for (; byteIndex < byteLen && k < type.bytes.length; byteIndex++, k++) {

						if (ignoreBytes.indexOf(k)!==-1) {
							continue; // skip ignore byte
						}
						if (buffer[byteIndex] !== type.bytes[k]) {
							matching = false;
							break;
						}
					}
					if (matching) {
						r.abort();

						var finalUrl = requestUrl;
						if (r.redirects && r.redirects.length > 0) {
							finalUrl = r.redirects[r.redirects.length-1].redirectUri;	
						}
						var parsedUrl = url.parse(finalUrl);
						var suffix = path.extname(parsedUrl.pathname);
						result.extension = suffix;

						fs.renameSync(info.path, info.path + suffix);
						result.tempPath = info.path+suffix;

						result.matched = true;
						result.matchedType = type.name;
						result.actual = finalUrl;
						return callback(null, result);
					}
				}
			}
		});
	});	
}

module.exports.fileTypes = fileTypes;

module.exports.checkPDF = function(requestUrl, callback) {
	checkUrl(requestUrl, fileTypes.pdf, callback);
};
module.exports.checkJPEG = function(requestUrl, callback) {
	checkUrl(requestUrl, fileTypes.jpeg, callback);
};
module.exports.checkGIF = function(requestUrl, callback) {
	checkUrl(requestUrl, fileTypes.gif, callback);
};
module.exports.checkPNG = function(requestUrl, callback) {
	checkUrl(requestUrl, fileTypes.png, callback);
};
module.exports.checkZIP = function(requestUrl, callback) {
	checkUrl(requestUrl, fileTypes.zip, callback);
};
module.exports.check = checkUrl;