'use strict'
const asyncLoop = require('node-async-loop');
const models = require('../../models');
const WellHeader = require('../wellHeader');
const hashDir = require('../../extractors/hash-dir');
const s3 = require('../s3');
const config = require('config');
let asyncEach = require('async/each');
let SqlString = require('sequelize/lib/sql-string');

async function importCurves(curves, dataset) {
    if (!curves || curves.length <= 0) return;
    const promises = curves.map(async curveData => {
        try {
            curveData.idDataset = dataset.idDataset;
            let curve = await models.Curve.create(curveData);

            curveData.idCurve = curve.idCurve;
            curveData.isCurrentRevision = true;
            const curveRevision = await models.CurveRevision.create(curveData);

            if (config.s3Path) {
                const key = hashDir.getHashPath(dataset.username + dataset.wellname + dataset.name + curveData.name + curveData.unit + curveData.step) + curveData.name + '.txt';
                s3.upload(config.dataPath + '/' + curveData.path, key)
                    .then(data => {
                        console.log(data.Location);
                    })
                    .catch(err => {
                        console.log(err);
                    });
                curveRevision.path = key;
                curveRevision.save();
            }
            else if (curveData.wellname != dataset.wellname || curveData.datasetname != dataset.name) {
                const oldCurve = {
                    username: dataset.username,
                    wellname: curveData.wellname,
                    datasetname: curveData.datasetname,
                    curvename: curveData.name,
                    unit: curveData.unit,
                    step: curveData.step
                }
                const newCurve = {
                    username: dataset.username,
                    wellname: dataset.wellname,
                    datasetname: dataset.name,
                    curvename: curveData.name,
                    unit: curveData.unit,
                    step: curveData.step
                };
                const changeSet = {};
                curveRevision.path = await require('../fileManagement').moveCurveFile(oldCurve, newCurve);
                curveRevision.save();
            }
            return curve;
        } catch (err) {
            // console.log('-------->' + err);
            // throw err;
            if (err.name == 'SequelizeUniqueConstraintError')
                return await models.Curve.findOne({
                    where: {
                        name: curveData.name,
                        idDataset: dataset.idDataset
                    }
                })
            else {
                console.log('-------->' + err);
                throw err;
            }
        }

    })
    return Promise.all(promises);
}

function _findOrCreate(models, tableName, queryOpts) {
    let Model = tableName === 'well' ? models.Well : models.Dataset;
    let sqlize = models.sequelize;
    let selectStm = "SELECT * FROM " + tableName;
    let queryStm = "WHERE";
    let isFirst = true;
    for (let prop in queryOpts.where) {
        let temp = prop + " = '" + queryOpts.where[prop] + "'";
        if (isFirst)
            queryStm = queryStm + " " + temp;
        else {
            queryStm = queryStm + " AND " + temp;
        }
        isFirst = false;
    }
    let query = selectStm + " " + queryStm;
    return new Promise(function (resolve, reject) {
        sqlize.query(query, {
            type: sqlize.QueryTypes.SELECT
        }).then(rs => {
            if (rs && rs.length) resolve(rs[0]);
            else {
                Model.create(queryOpts.defaults).then(well => {
                    resolve(well);
                }).catch(err => {
                    console.log(err);
                    reject(err);
                });
            }
        }).catch(err => {
            reject(err);
        });
    });
}

function importWithOverrideOption(wellData) {
    return new Promise(function (resolve, reject) {
        _findOrCreate(models, "well", {
            where: {name: wellData.name, username: wellData.username},
            defaults: {name: wellData.name, username: wellData.username, filename: wellData.filename}
        }).then(well => {
            asyncEach(wellData.datasets, function (dataset, nextDataset) {
                models.Dataset.findOrCreate({
                    where: {idWell: well.idWell, name: dataset.name},
                    defaults: {
                        name: dataset.name,
                        top: dataset.top,
                        bottom: dataset.bottom,
                        step: dataset.step,
                        idWell: well.idWell
                    }
                }).then(_dataset => {
                    asyncEach(dataset.curves, function (curve, nextCurve) {
                        _findOrCreate(models, "dataset", {
                            where: {idDataset: _dataset[0].idDataset, name: curve.name},
                            defaults: {
                                name: curve.name,
                                idDataset: _dataset[0].idDataset
                            }
                        }).then(_curve => {
                            curve.idCurve = _curve[0].idCurve;
                            curve.isCurrentRevision = true;
                            models.CurveRevision.findOrCreate({
                                where: {idCurve: _curve.idCurve, path: curve.path},
                                defaults: curve
                            }).then(() => {
                                nextCurve();
                            }).catch(err => {
                                console.log("curverevision", err);
                                nextCurve();
                            });
                        }).catch(err => {
                            console.log(err);
                            nextCurve();
                        });
                    }, function () {
                        nextDataset();
                    });
                }).catch(err => {
                    console.log(err);
                    nextDataset();
                });
            }, function () {
                resolve(well);
            });
        }).catch(err => {
            console.log(err);
        });


        // models.Well.findOrCreate({
        //     where: {name: wellData.name, username: wellData.username, filename: wellData.filename},
        //     defaults: {
        //         name: wellData.name, username: wellData.username, filename: wellData.filename
        //     }
        // }).then(rs => {
        //     let well = rs[0].toJSON();
        //     asyncEach(wellData.datasets, function (dataset, nextDataset) {
        //         models.Dataset.findOrCreate({
        //             where: {idWell: well.idWell, name: dataset.name},
        //             defaults: {
        //                 name: dataset.name,
        //                 top: dataset.top,
        //                 bottom: dataset.bottom,
        //                 step: dataset.step,
        //                 idWell: well.idWell
        //             }
        //         }).then(_dataset => {
        //             asyncEach(dataset.curves, function (curve, nextCurve) {
        //                 models.Curve.findOrCreate({
        //                     where: {idDataset: _dataset[0].idDataset, name: curve.name},
        //                     defaults: {
        //                         name: curve.name,
        //                         idDataset: _dataset[0].idDataset
        //                     }
        //                 }).then(_curve => {
        //                     curve.idCurve = _curve[0].idCurve;
        //                     curve.isCurrentRevision = true;
        //                     models.CurveRevision.findOrCreate({
        //                         where: {idCurve: _curve.idCurve, path: curve.path},
        //                         defaults: curve
        //                     }).then(() => {
        //                         nextCurve();
        //                     }).catch(err => {
        //                         console.log("curverevision", err);
        //                         nextCurve();
        //                     });
        //                 }).catch(err => {
        //                     console.log(err);
        //                     nextCurve();
        //                 });
        //             }, function () {
        //                 nextDataset();
        //             });
        //         }).catch(err => {
        //             console.log(err);
        //             nextDataset();
        //         });
        //     }, function () {
        //         resolve(well);
        //     });
        // });
    });
}

async function importWell(wellData, override) {
    try {
        console.log("==wellData ", wellData, wellData.name, wellData.username);
        let well
        if (override) {
            try {
                well = await importWithOverrideOption(wellData);
                well.Override = true;
            } catch (err) {
                console.log(err);
            }
        } else {
            well = await models.Well.create(wellData);
            well.datasets = await importDatasets(wellData.datasets, well, false);
        }
        let arr = ['username', 'datasets', 'name', 'params'];
        for (let property in WellHeader) {
            let well_header = {};
            if (wellData[WellHeader[property].LASMnemnics]) {
                well_header = wellData[WellHeader[property].LASMnemnics];
            }
            else if (wellData[WellHeader[property].CSVMnemnics]) {
                well_header = wellData[WellHeader[property].CSVMnemnics];
            }
            arr.push(property);
            well_header.idWell = well.idWell;
            well_header.header = property;
            models.WellHeader.upsert(well_header)
                .catch(err => {
                    console.log('=============' + err)
                })
        }

        for (let header in wellData) {
            if (!arr.includes(header))
                models.WellHeader.upsert({
                    idWell: well.idWell,
                    header: header,
                    value: wellData[header].value,
                    description: wellData[header].description,
                    standard: false
                }).catch(err => {
                    console.log(err)
                })
        }
        return well;
    } catch
        (err) {
        console.log(err);
        console.log('===' + err + "===> It's ok, rename now")
        if (err.name == 'SequelizeUniqueConstraintError') {
            if (wellData.name.indexOf(' ( copy ') < 0) {
                wellData.name = wellData.name + ' ( copy 1 )';
            }
            else {
                let copy = wellData.name.substr(wellData.name.lastIndexOf(' ( copy '), wellData.name.length);
                let copyNumber = parseInt(copy.replace(' ( copy ', '').replace(' )', ''));
                copyNumber++;
                wellData.name = wellData.name.replace(copy, '') + ' ( copy ' + copyNumber + ' )';
            }
            return await
                importWell(wellData);
        }
        else {
            throw err;
        }
    }
}

async function importDatasets(datasets, well, override) {
    console.log("---------------------->>>> " + JSON.stringify(well))
    if (!datasets || datasets.length <= 0) return;
    try {
        const promises = datasets.map(async datasetData => {
            let dataset = null;
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
            try {
                if (!dataset) dataset = await models.Dataset.create(datasetData);
            } catch (err) {
                console.log('>>>>>>>' + err);
                throw err;
            }

            dataset = dataset.toJSON();
            dataset.wellname = well.name;
            dataset.username = well.username;

            datasetData.params.forEach(param => {
                param.idDataset = dataset.idDataset;
                models.DatasetParams.create(param)
                    .catch(err => {
                        console.log('import to well_parameter failed ===> ' + err);
                    })
            })
            const curves = await importCurves(datasetData.curves, dataset)
            dataset.curves = curves;
            return dataset;
        })
        return Promise.all(promises);
    } catch (err) {
        throw err;
    }

}

function importToDB(inputWells, importData, cb) {
    console.log('importToDB inputWell: ' + JSON.stringify(inputWells));
    if (!inputWells || inputWells.length <= 0) return cb('there is no well to import');
    let res = [];
    const promises = inputWells.map(async inputWell => {
        try {
            inputWell.username = importData.userInfo.username;
            // let well = null;
            // if (inputWell.idWell) {
            //     well = await models.Well.findById(inputWell.idWell);
            // } else if (importData.override) {
            //     well = await models.Well.findOne({
            //         where: {
            //             name: importData.wellname
            //         },
            //         raw: true
            //     })
            // }
            // if (well) {
            //     const datasets = await importDatasets(inputWell.datasets, well, importData.override ? true : false);
            //     well.datasets = datasets;
            //     return well;
            // } else {
            //     return await importWell(inputWell);
            // }
            return await importWell(inputWell, importData.override);
        } catch (err) {
            console.log('===> ' + err)
            throw err;
        }
    })
    Promise.all(promises)
        .then(wells => {
            console.log("=================> " + JSON.stringify(wells))
            cb(null, wells)
        })
        .catch(err => cb(err))
}

module.exports = importToDB;