'use strict'

const models = require('../../models');
const WellHeader = require('../wellHeader');
const hashDir = require('wi-import').hashDir;
const s3 = require('../../s3');
const config = require('config');
const asyncEach = require('async/each');
const fs = require('fs');
const curveModel = require('../../curve/curve.model');
const readline = require('readline');
const convert = require('../../utils/convert');

function isFloatEqually(float1, float2) {
    const epsilon = 10 ** -7;
    let rFloat1 = Math.round(float1 * 10 ** 6) / 10 ** 6;
    let rFloat2 = Math.round(float2 * 10 ** 6) / 10 ** 6;
    var delta = Math.abs(rFloat1 - rFloat2);
    return delta < epsilon;
}

//return    -1 if float1 < float2
//          0 if float1 == float2
//          1 if float1 > float2
function floatStrCompare(float1, float2) {
    const var1 = parseFloat(float1);
    const var2 = parseFloat(float2);
    if (isFloatEqually(var1, var2)) return 0;
    if (var1 < var2) return -1;
    if (var1 > var2) return 1;
}

async function importCurves(curves, dataset) {
    if (!curves || curves.length <= 0) return;
    const promises = curves.map(async curveData => {
        try {
            curveData.name = curveData.name.replace(/[¤&:*?"<>|.]/g, '_');
            curveData.idDataset = dataset.idDataset;
            let curve = await models.Curve.create(curveData); // create curve

            curveData.idCurve = curve.idCurve;
            curveData.isCurrentRevision = true;
            const curveRevision = await models.CurveRevision.create(curveData); //create curve revision

            if (process.env.INVENTORY_S3PATH || config.s3Path) {
                const key = hashDir.getHashPath(dataset.username + dataset.wellname + dataset.name + curveData.name + curveData.unit + curveData.step) + curveData.name + '.txt';
                await s3.upload((process.env.INVENTORY_DATAPATH || config.dataPath) + '/' + curveData.path, key, dataset.direction == 'DECREASING')
                    .then(data => {
                        // console.log("s3 uploaded: " + key);
                    })
                    .catch(err => {
                        console.log("s3 upload failed: " + err);
                    });
            }
            else  {
                const oldCurve = {
                    username: dataset.username,
                    wellname: curveData.wellname,
                    datasetname: curveData.datasetname,
                    curvename: curveData.name,
                    unit: curveData.unit,
                    step: curveData.step,
                    description: curveData.description,
                    path: curveData.path
                };
                const newCurve = {
                    username: dataset.username,
                    wellname: dataset.wellname,
                    datasetname: dataset.name,
                    curvename: curveData.name,
                    unit: curveData.unit,
                    step: curveData.step,
                    description: curveData.description
                };
                await require('../../fileManagement').moveCurveFile(oldCurve, newCurve);
            }
            return curve;
        } catch (err) {
            // console.log('-------->' + err);
            // throw err;
            if (err.name === 'SequelizeUniqueConstraintError')
                return await models.Curve.findOne({
                    where: {
                        name: curveData.name,
                        idDataset: dataset.idDataset
                    }
                });
            else {
                console.log('-------->' + err);
                throw err;
            }
        }

    });
    return Promise.all(promises);
}


async function importWell(wellData, override) {
    try {
        // console.log("==wellData ", wellData, wellData.name, wellData.username);
        // console.log(wellData);
        let well, wellTop, wellStop, wellStep;
        const Op = require('sequelize').Op;
        wellData.name = wellData.name.replace(/[¤&:*?"<>|.]/g, '_');

        if (override) {
            well = (await models.Well.findOrCreate({
                where: {
                    [Op.and]: [
                        {name: {[Op.eq]: wellData.name}},
                        {username: wellData.username},
                    ]
                },
                defaults: {
                    name: wellData.name, username: wellData.username, filename: wellData.filename
                },
                include: {
                    model: models.WellHeader
                }
            }))[0];
        } else {
            well = await models.Well.create(wellData);
        }
        well.datasets = await importDatasets(wellData.datasets, well, false);
        if (well.well_headers) {
            wellTop = well.well_headers.find(h => h.header === "STRT");
            wellStop = well.well_headers.find(h => h.header === "STOP");
            wellStep = well.well_headers.find(h => h.header === "STEP");
        }
        let arr = ['username', 'datasets', 'name', 'params'];
        for (let property in WellHeader) {
            let well_header = {};
            if (wellData[WellHeader[property].CSVMnemnics]) {
                well_header = wellData[WellHeader[property].CSVMnemnics];
                delete wellData[WellHeader[property].CSVMnemnics];
            }
            else {
                for (let mnem of WellHeader[property].LASMnemnics) {
                    if (wellData[mnem]) {
                        well_header = wellData[mnem];
                        delete wellData[mnem];
                    }
                }
            }

            arr.push(property);
            well_header.idWell = well.idWell;
            well_header.header = property;
            if (well_header.header === "STEP" && wellStep) {
                well_header.unit = wellStep.unit;
                well_header.value = wellStep.value;
            }
            if (well_header.header === "STRT" && wellTop) {
                // console.log(well_header, wellTop.toJSON());
                if (well_header.unit !== wellTop.unit) {
                    well_header.value = convert.convertDistance(well_header.value, well_header.unit, wellTop.unit);
                    well_header.unit = wellTop.unit;
                }
                // console.log("START =============", well_header.value);
                well_header.value = floatStrCompare(well_header.value, wellTop.value) == 1 ? wellTop.value : well_header.value;

            }
            if (well_header.header === "STOP" && wellStop) {
                // console.log(well_header, wellStop.toJSON());
                if (well_header.unit !== wellStop.unit) {
                    well_header.value = convert.convertDistance(well_header.value, well_header.unit, wellStop.unit);
                    well_header.unit = wellStop.unit;
                }
                // console.log("STOP =============", well_header.value);
                well_header.value = floatStrCompare(well_header.value, wellStop.value) == -1 ? wellStop.value : well_header.value;
            }
            if (well_header.header == "NULL") {
                well_header.value = "-9999";
            }
            models.WellHeader.upsert(well_header)
                .catch(err => {
                    console.log('=============' + err)
                })
        }

        for (let header in wellData) {
            if (!arr.includes(header) && header !== 'TD')
                models.WellHeader.upsert({
                    idWell: well.idWell,
                    header: header,
                    value: wellData[header].value,
                    description: wellData[header].description,
                    unit: wellData[header].unit,
                    standard: false
                }).catch(err => {
                    console.log(err)
                })
        }
        return well;
    } catch (err) {
        if (err.name === 'SequelizeUniqueConstraintError') {
            if(!override) {
                if (wellData.name.indexOf(' ( copy ') < 0) {
                    wellData.name = wellData.name + ' ( copy 1 )';
                }
                else {
                    let copy = wellData.name.substr(wellData.name.lastIndexOf(' ( copy '), wellData.name.length);
                    let copyNumber = parseInt(copy.replace(' ( copy ', '').replace(' )', ''));
                    copyNumber++;
                    wellData.name = wellData.name.replace(copy, '') + ' ( copy ' + copyNumber + ' )';
                }
            }
            return await importWell(wellData, override);
        }
        else {
            throw err;
        }
    }
}

async function importDatasets(datasets, well, override) {
    //override = true means that override dataset
    // console.log("---------------------->>>> " + JSON.stringify(well));
    // console.log("=========", datasets);
    if (!datasets || datasets.length <= 0) return;
    try {
        const promises = datasets.map(async datasetData => {
            let dataset = null;
            datasetData.name = datasetData.name.replace(/[¤&:*?"<>|.]/g, '_');
            datasetData.idWell = well.idWell;
            if (datasetData.idDataset) {
                dataset = await models.Dataset.findOne({
                    where: {
                        idDataset: datasetData.idDataset
                    }
                })
            }
            else if (override) {
                dataset = await models.Dataset.findOne({
                    where: {
                        name: datasetData.name,
                        idWell: well.idWell
                    }
                })
            }

            async function createDataset(datasetInfo) {
                try {
                    const dataset = await models.Dataset.create(datasetInfo);
                    return dataset;
                } catch (err) {
                    if (err.name === 'SequelizeUniqueConstraintError') {
                        if (datasetData.name.length <= 2) {
                            datasetData.name = datasetData.name + '_1';
                        }
                        else {
                            const _index = datasetData.name.lastIndexOf('_');
                            const copy = datasetData.name.substr(_index + 1, datasetData.name.length);
                            if(isNaN(copy)){
                                datasetData.name = datasetData.name + '_1';
                            }else {
                                const copyNumber = parseInt(copy) + 1;
                                datasetData.name = datasetData.name.substr(0, _index) + '_' + copyNumber;
                            }
                        }
                        return await createDataset(datasetData);
                    }
                    else {
                        throw err;
                    }
                }
            }

            if (!dataset) dataset = await createDataset(datasetData);

            dataset = dataset.toJSON();
            dataset.wellname = well.name;
            dataset.username = well.username;
            dataset.direction = datasetData.direction;

            datasetData.params.forEach(param => {
                if (param.mnem == 'SET') return;
                param.idDataset = dataset.idDataset;
                models.DatasetParams.create(param)
                    .catch(err => {
                        console.log('import to well_parameter failed ===> ' + err);
                    });
            });
            const curves = await importCurves(datasetData.curves, dataset);
            dataset.curves = curves;
            return dataset;
        });
        return Promise.all(promises);
    } catch (err) {
        throw err;
    }

}

async function importToDB(inputWells, importData) {
    // console.log('importToDB inputWell: ' + JSON.stringify(inputWells));
    if (!inputWells || inputWells.length <= 0) return Promise.reject('there is no well to import');
    const promises = inputWells.map(async inputWell => {
        try {
            inputWell.username = importData.userInfo.username;
            if (inputWell.STRT && inputWell.STOP && inputWell.STEP && inputWell.NULL) {
                inputWell.STRT.value = inputWell.STRT.value.replace(/,/g, "");
                inputWell.STOP.value = inputWell.STOP.value.replace(/,/g, "");
                inputWell.STEP.value = inputWell.STEP.value.replace(/,/g, "");
                inputWell.NULL.value = inputWell.NULL.value.replace(/,/g, "");
            }
            return await importWell(inputWell, importData.override);
        } catch (err) {
            console.log('===> ' + err);
            throw err;
        }
    });
    return Promise.all(promises);
}

module.exports = importToDB;
