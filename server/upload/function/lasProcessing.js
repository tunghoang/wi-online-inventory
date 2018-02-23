'use strict';

const asyncLoop = require('node-async-loop');
const LASExtractor = require("../../../extractors/las/las-extractor");
const importToDB = require('./importToDB');

function processFileUpload(file, importData, callback) {
    console.log("______processFileUpload________");
    console.log(JSON.stringify(file));
    let fileFormat = file.filename.substring(file.filename.lastIndexOf('.') + 1);
    if (/LAS/.test(fileFormat.toUpperCase())) {
        LASExtractor(file, importData, function (err, result) {
            if (err) {
                console.log("extract las file failed");
                callback(err, null);
            }
            else {
                importToDB(result, importData, function (err, result) {
                    if (err) {
                        callback(err, null);
                    }
                    else {
                        callback(null, result);
                    }
                });
            }
        })
    }
    else {
        callback('this is not las file', null);
    }
}

function uploadLasFiles(req, cb) {
    if (!req.files) return cb('NO FILE CHOSEN!!!');
    let output = [];
    let importData = {};
    importData.userInfo = req.decoded;
    importData.override = !!(req.body.override && req.body.override === "true");
    asyncLoop(req.files, (file, next) => {
        if (!file) return next('NO FILE CHOSEN!!!');
        processFileUpload(file, importData, (err, result) => {
            if (err) next(err);
            else {
                output.push(result);
                next();
            }
        });
    }, (err) => {
        if (err) cb(err, null);
        else cb(null, output);
    });
}

module.exports = {
    uploadLasFiles: uploadLasFiles
};