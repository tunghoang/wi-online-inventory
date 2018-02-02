'use strict'
const models = require('../../models');
const Well = models.Well;
const Dataset = models.Dataset;
const User = models.User;
const Curve = models.Curve;
const config = require('config');
const hashDir = require('../../extractors/hash-dir');

function createCurve(body, cb) {
    Curve.create(body).then(curve => {
        cb(null, curve);
    }).catch(err => {
        cb(err, null);
    });
}

function findCurveById(idCurve, username, attributes) {
    let include = [{
        model: Dataset,
        attributes : attributes && attributes.dataset ? attributes.dataset : [],
        required: true,
        include: {
            model: Well,
            attributes: attributes && attributes.well? attributes.well : [],
            required: true,
            include: {
                model: User,
                attributes: attributes && attributes.user ? attributes.user : [],
                required: true,
                where: {
                    username: username
                }
            }
        }
    }]
    if(attributes && attributes.revision){
        include.push({
            model: models.CurveRevision
        })
    }
    return Curve.findById(idCurve, {
        include : include
        //logging: console.log
    });
}

function deleteCurveFiles(curves) {
    //curves must be array
    console.log('~~~deleteCurveFiles~~~');
    if(!curves || curves.length <= 0) return;
    curves.forEach(curve => {
        if(config.s3Path){
            //be sure to delete all unit exported curve files
            require('../s3').deleteCurve(curve);
        }
        else {
            //be sure to delete all unit exported curve files
            curve.curve_revisions.forEach(revision => {
                const path = config.dataPath + '/' + revision.path;
                require('fs').unlink(path, (err) => {
                    if(err) console.log('delete curve file failed: ' + err);
                });
            })
        }
    })
}

async function deleteCurve(idCurve, username, callback) {
    const attributes = {
        revision: true
    }
    const curve = await findCurveById(idCurve, username, attributes);
    curve.destroy()
        .then((rs)=>{
            deleteCurveFiles([curve]);
            callback(null, rs);
        })
        .catch((err) => {
            callback(err, null);
        })

}

async function getCurves(idDataset, username, cb) {
    try {
        const curves = await Curve.findAll({
            where: {
                idDataset: idDataset
            },
            include : [{
                model: Dataset,
                attributes : [],
                required: true,
                include: {
                    model: Well,
                    attributes: [],
                    required: true,
                    include: {
                        model: User,
                        attributes: [],
                        required: true,
                        where: {
                            username: username
                        }
                    }
                }
            }, {
                model: models.CurveRevision,
                where: {
                    isCurrentRevision: true
                }
            }],
            raw: true
            // logging: console.log
        });
        for(let curve of curves){
            for(let property in curve){
                if(property.indexOf('curve_revisions.') >= 0){
                    curve[property.replace('curve_revisions.', '')] = curve[property];
                    delete curve[property];
                }
            }
        }
        return cb(null, curves);
    } catch (err){
        console.log(err);
        return cb(err)
    }

}

async function editCurve(body, username, cb){
    try {
        let attributes = {
            well: ['name'],
            dataset: ['name'],
            revision: true
        }
        let curve = await findCurveById(body.idCurve, username, attributes);
        let currentRevision = {};
        for(const revision of curve.curve_revisions){
            if(revision.isCurrentRevision) currentRevision = revision;
        }
        curve.username = username;
        if (curve) {
            if (body.name && curve.name != body.name) editCurveName(curve, body.name, cb)
            else if(body.unit && body.unit != currentRevision.unit) editCurveUnit(curve, body.unit, cb)
            else if(body.step && body.step != currentRevision.step) editCurveStep(curve, body.step, cb)
            else return cb();
        }
        else {
            return cb('No curve found to edit')
        }
    } catch(err) {
        console.log('failed to edit curve: ' + err)
        cb(err);
    }

}

async function createRevision(curve, newUnit, newStep) {
    try {
        let currentRevision = {};
        for (const revision of curve.curve_revisions) {
            if (revision.isCurrentRevision) currentRevision = revision;
        }
        let newRevision = Object.assign({}, currentRevision.toJSON());
        currentRevision.isCurrentRevision = false;
        currentRevision.save();
        console.log(newRevision)
        delete newRevision.createdAt;
        delete newRevision.updatedAt;
        delete newRevision.idRevision;
        if(newStep) newRevision.step = newStep;
        else if(newUnit) newRevision.unit = newUnit;

        const oldPath = config.dataPath + '/' + currentRevision.path;
        const dir = curve.username + curve.dataset.well.name + curve.dataset.name + curve.name + newRevision.unit + newRevision.step;
        const filePath = hashDir.createPath(config.dataPath, dir, curve.name + '.txt');
        newRevision.path = filePath.replace(config.dataPath + '/', '');
        if(newStep)curveInterpolation(currentRevision, newRevision);
        else if(newUnit){
            const fs = require('fs');
            fs.createReadStream(oldPath).pipe(fs.createWriteStream(filePath));
        }
        const updatedRevision = await models.CurveRevision.create(newRevision);

        // const fs = require('fs');
        // fs.createReadStream(oldPath).pipe(fs.createWriteStream(filePath));
        return updatedRevision;
        // const desHashStr = newCurve.username + newCurve.wellname + newCurve.datasetname + newCurve.curvename + newCurve.unit + newCurve.step;
        // const desPath = hash_dir.createPath(config.dataPath, desHashStr , newCurve.curvename + '.txt');
    }
    catch(err) {
        console.log('failed to create revision: ' + err)
        return null;
    }
}

async function editCurveName(curve, newName, cb) {
    try {
        const originalName = curve.name;
        curve.name = newName;
        const updatedCurve = await curve.save();
        for (const revision of curve.curve_revisions) {
            const hashStr = curve.username + curve.dataset.well.name + curve.dataset.name + newName + revision.unit + revision.step;
            const path = hashDir.getHashPath(hashStr) + newName + '.txt';
            const oldCurve = {
                username: curve.username,
                wellname: curve.dataset.well.name,
                datasetname: curve.dataset.name,
                curvename: originalName,
                unit: revision.unit,
                step: revision.step
            }
            const newCurve = Object.assign({}, oldCurve);
            newCurve.curvename = newName;
            revision.path = path;
            await revision.save();
            require('../fileManagement').moveCurveFile(oldCurve, newCurve);
        }
        return cb(null, updatedCurve)
    }catch (err) {
        console.log(err);
        cb(err);
    }
}

async function editCurveUnit(curve, newUnit, cb) {
    try {
        let currentRevision = {};
        let updatedCurve = {};
        for (const revision of curve.curve_revisions) {
            if (revision.isCurrentRevision) currentRevision = revision;
        }

        let isRevisionExisted = false;
        for (let revision of curve.curve_revisions) {
            if (revision.unit == newUnit && revision.step == currentRevision.step) {
                revision.isCurrentRevision = true;
                isRevisionExisted = true;
                updatedCurve = await revision.save();
            }
        }
        if(!isRevisionExisted){
            updatedCurve = await createRevision(curve, newUnit);
        }
        return cb(null, updatedCurve);

    }catch (err){
        console.log(err);
        cb(err);
    }
}

async function editCurveStep(curve, newStep, cb) {
    try {
        let currentRevision = {};
        let steps = [];
        let updatedCurve = {};
        for (const revision of curve.curve_revisions) {
            if (revision.isCurrentRevision) currentRevision = revision;
            if (!steps.includes(revision.step)) steps.push(revision.step);
        }
        let isRevisionExisted = false;
        for (let revision of curve.curve_revisions) {
            if (revision.step == newStep && revision.unit == currentRevision.unit) {
                currentRevision.isCurrentRevision = false;
                currentRevision.save();

                revision.isCurrentRevision = true;
                isRevisionExisted = true;
                updatedCurve = await revision.save();
                break;
            }
        }
        if(!isRevisionExisted) {
            updatedCurve = await createRevision(curve, null, newStep);
        }
        cb(null, updatedCurve);
    }catch (err){
        console.log(err);
        cb(err);
    }
}

function curveInterpolation(originRevision, newRevision) {
    const fs = require('fs');
    const originPath = config.dataPath + '/' + originRevision.path;
    const path = config.dataPath + '/' + newRevision.path;
    if(config.s3Path){
        const tempPath =  fs.mkdtempSync(require('os').tmpdir());
        let newKey = curve.path.substring(0, curve.path.lastIndexOf('/') + 1) + newUnit + '_' + curve.name + '.txt';
        let pathOnDisk = tempPath + '/' + newUnit + '_' + curve.name + '.txt';
        const writeStream = fs.createWriteStream(pathOnDisk);
        const rl = readline.createInterface({
            input: s3.getData(originRevision.path)
        })
        rl.on('line', line => {

        })

    }
    const curveContents = fs.readFileSync(originPath, 'utf8').trim().split('\n');
    let curveDatas = [];
    for (const line of curveContents){
        curveDatas.push(Number(line.trim().split(' ')[1]));
    }
    const numberOfPoint = Math.floor((Number(newRevision.stopDepth) - Number(newRevision.startDepth))/Number(newRevision.step));
    for(let i = 0; i < numberOfPoint; i++){
        const originIndex = i * newRevision.step / originRevision.step;
        if(Number.isInteger(originIndex)){
            fs.appendFileSync(path, i + ' ' + curveDatas[originIndex] + '\n');
        }
        else {
            const preIndex = Math.floor(originIndex);
            const postIndex = Math.ceil(originIndex);
            const value = (curveDatas[postIndex] - curveDatas[preIndex]) * (originIndex - preIndex) / (postIndex - preIndex) + curveDatas[preIndex];
            fs.appendFileSync(path, i + ' ' + value + '\n');
        }
    }
}

module.exports = {
    findCurveById: findCurveById,
    deleteCurve : deleteCurve,
    getCurves: getCurves,
    deleteCurveFiles: deleteCurveFiles,
    createCurve: createCurve,
    editCurve: editCurve
}