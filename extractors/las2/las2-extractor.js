'use strict';
let readline = require('line-by-line');
let hashDir = require('../hash-dir');
let fs = require('fs');
let __config = require('../common-config');
const s3 = require('../../controllers/s3');
const config = require('config');


function getLASVersion(inputURL, callback) {
    let result = {
        lasVersion: 0,
        delimiting: "SPACE"
    }
    let section = null;
    let rl = new readline(inputURL);
    rl.on('line', function (line) {
        line = line.trim();
        line = line.toUpperCase();
        line = line.replace(/\s+\s/g, " ");
        if (/^~/.test(line)) {
            section = line;
        } else if (/^[A-z]/.test(line)) {
            if (/VERSION/.test(section)) {
                if (/VERS/.test(line)) {
                    let dotPosition = line.indexOf('.');
                    let colon = line.indexOf(':');
                    let versionString = line.substring(dotPosition + 1, colon);
                    /2/.test(versionString) ? result.lasVersion = 2 : result.lasVersion = 3;
                } else if (/DLM/.test(line)) {
                    let dotPosition = line.indexOf('.');
                    let colon = line.indexOf(':');
                    let dlmString = line.substring(dotPosition + 1, colon);
                    result.delimiting = dlmString.trim();
                }
            }
        }
    });
    rl.on('end', function () {
        callback(null, result);
    });
    rl.on('err', function (err) {
        callback(err, null);
    });
}

function extractCurves(inputURL, importData, callback) {
    let rl = new readline(inputURL, { skipEmptyLines : true });
    let sectionName = "";
    let curves = [];
    let count = 0;
    let wellInfo = importData.well ? importData.well :  new Object();
    let filePaths = new Object();
    let BUFFERS = new Object();
    let fields = [];
    let isFirstCurve = true;

    rl.on('line', function (line) {
        line = line.trim();
        line = line.toUpperCase();
        line = line.replace(/\s+\s/g, " ");

        if (/^~/.test(line)) {
            sectionName = line.substring(0, 2);
        } else if(/^#/.test(line)){
            return;
        } else if (sectionName == '~W') {
            if(importData.well) return;
            const mnem = line.substring(0, line.indexOf('.'));
            line = line.substring(line.indexOf('.'));
            const data = line.substring(line.indexOf(' '), line.indexOf(':')).trim();

            if ((/WELL/).test(mnem) && !/UWI/.test(mnem)) {
                wellInfo.name = data;
            } else if (/STRT/.test(mnem)) {
                wellInfo.start = data;
            } else if (/STOP/.test(mnem)) {
                wellInfo.stop = data;
            } else if (/STEP/.test(mnem)) {
                wellInfo.step = data;
            } else if (/NULL/.test(mnem)) {
                wellInfo.null = data;
            }
        } else if (sectionName == '~C') {

            if(isFirstCurve){
                isFirstCurve = false;
                return;
            }

            let curve = new Object();
            let curveName = line.substring(0, line.indexOf('.')).trim();
            line = line.substring(line.indexOf('.') + 1);

            let unit = line.substring(0, line.indexOf(' ')).trim();
            if (unit.indexOf("00") != -1) unit = unit.substring(0, unit.indexOf("00"));
            curve.name = curveName;
            curve.unit = unit;
            curve.datasetname = wellInfo.name;
            // curve.wellname = wellInfo.name;
            curve.initValue = "abc";
            curve.family = "VNU";
            curve.idDataset = null;
            BUFFERS[curveName] = {
                count: 0,
                data: ""
            };
            filePaths[curveName] = hashDir.createPath(__config.basePath,importData.userInfo.username + wellInfo.name + curve.datasetname + curveName, curveName + '.txt');
            // filePaths[curveName] = hashDir.createPath(__config.basePath, new Date().getTime().toString() + curveName , curveName + '.txt');
            fs.writeFileSync(filePaths[curveName], "");
            curve.path = filePaths[curveName];
            curves.push(curve);
        } else if (sectionName == '~A'){
            fields = fields.concat(line.trim().split(' '));
            if(fields.length > curves.length) {
                if (curves) {
                    curves.forEach(function (curve, i) {
                        writeToCurveFile(BUFFERS[curve.name], curve.path, count, fields[i + 1], wellInfo.null);
                    });
                    count++;
                }
                fields = [];
            }
        }
    });
    rl.on('end', function () {
        deleteFile(inputURL);
        wellInfo.datasets = [];
        let dataset = {
            name: wellInfo.name,
            datasetKey: wellInfo.name,
            datasetLabel: wellInfo.name,
            curves: null
        }
        dataset.curves = curves.map(function (curve) {
            fs.appendFileSync(curve.path, BUFFERS[curve.name].data);
            curve.path = curve.path.replace(config.dataPath + '/', '');
            if(config.s3Path) {
                s3.upload(curve);
            }
            return curve;
        });

        wellInfo.datasets.push(dataset);
        callback(false, wellInfo);
    });
    rl.on('err', function (err) {
        deleteFile(inputURL);
        callback(err, null);
    });
}

function writeToCurveFile(buffer, curveFileName, index, value, defaultNull) {
    buffer.count += 1;
    if (value == defaultNull) {
        buffer.data += index + " null" + "\n";
    }
    else {
        buffer.data += index + " " + value + "\n";
    }
    if (buffer.count >= 1000) {
        fs.appendFileSync(curveFileName, buffer.data);
        buffer.count = 0;
        buffer.data = "";
    }
}

function extractWell(inputURL, callback) {
    let rl = new readline(inputURL);
    let sectionName = "";
    let datasetsName = [];
    let curves = [];
    let wellInfo = new Object();

    rl.on('line', function (line) {
        line = line.trim();
        line = line.toUpperCase();
        line = line.replace(/\s+\s/g, " ");

        if (/^~/.test(line)) {
            sectionName = line;
        } else if (/^[A-z]/.test(line)) {
            if (/WELL/.test(sectionName)) {
                let wellname = "";
                let start = "";
                let stop = "";
                let step = "";
                let NULL = "";
                if ((/WELL/).test(line) && !/UWI/.test(line)) {
                    wellname = line.substring(line.indexOf('.') + 1, line.indexOf(':')).trim();
                    wellInfo.name = wellname;
                } else if (/STRT/.test(line)) {
                    start = line.substring(line.indexOf('.') + 2, line.indexOf(':')).trim();
                    wellInfo.start = start;
                } else if (/STOP/.test(line)) {
                    stop = line.substring(line.indexOf('.') + 2, line.indexOf(':')).trim();
                    wellInfo.stop = stop;
                } else if (/STEP/.test(line)) {
                    step = line.substring(line.indexOf('.') + 2, line.indexOf(':')).trim();
                    wellInfo.step = step;
                } else if (/NULL/.test(line)) {
                    NULL = line.substring(line.indexOf('.') + 1, line.indexOf(':')).trim();
                    wellInfo.null = NULL;
                }
            } else if (/CURVE/.test(sectionName)) {
                let curve = new Object();
                let curveName = "";
                let unit = "";
                curveName = line.substring(0, line.indexOf('.')).trim();
                unit = line.substring(line.indexOf('.') + 1, line.indexOf(':')).trim();
                curve.name = curveName;
                curve.unit = unit;
                curve.datasetname = wellInfo.name;
                curve.wellname = wellInfo.name;
                curve.initValue = "abc";
                curve.family = "VNU";
                curve.idDataset = null;
                if (!/DEPTH/.test(curve.name)) {
                    curves.push(curve);
                }
            }
        } else if (/^[0-9][0-9]/.test(line)) {
        }
    });
    rl.on('end', function () {
        deleteFile(inputURL);
        wellInfo.datasetInfo = [];
        let dataset = {
            name: wellInfo.name,
            datasetKey: wellInfo.name,
            datasetLabel: wellInfo.name,
            curves: null
        }
        dataset.curves = curves;
        wellInfo.datasetInfo.push(dataset);
        callback(false, wellInfo);
    });
    rl.on('err', function (err) {
        deleteFile(inputURL);
        callback(err, null);
    });

}

function extractAll(inputURL, importData, callbackGetSections) {
    getLASVersion(inputURL, function (err, result) {
        if (err) {
            callbackGetSections(err, result);
        } else {
            if (result.lasVersion == 2) {
                extractCurves(inputURL, importData, function (err, info) {
                    if (err) callbackGetSections(err, null);
                    callbackGetSections(false, info);
                });
            } else if (result.lasVersion == 3) {
                callbackGetSections("LAS_3_DETECTED", null);
            }
        }
    });
``
}

function deleteFile(inputURL) {
    fs.unlink(inputURL, function (err) {
        if (err) return console.log(err);
    });
}

module.exports.getLASVersion = getLASVersion;
module.exports.extractCurves = extractCurves;
module.exports.extractWell = extractWell;
module.exports.extractAll = extractAll;
module.exports.deleteFile = deleteFile;
module.exports.setBasePath = function (basePath) {
    __config.basePath = basePath;
};

module.exports.getBasePath = function () {
    return __config.basePath;
};