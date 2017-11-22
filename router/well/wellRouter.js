"use strict";
let express = require('express');
let router = express.Router();
let bodyParser = require('body-parser');
let models = require('../../models/index');
let Well = models.Well;
let response = require('../response');
let wellModel = require('./well.model');

router.use(bodyParser.json());

router.post('/well/new', function (req, res) {
    Well.create(req.body).then(well => {
        res.send(response(200, 'SUCCESSFULLY CREATE NEW WELL', well));
    }).catch(err => {
        res.send(response(500, 'FAILED TO CREATE NEW WELL', err));
    });
});

router.post('/well/info', function (req, res) {
    wellModel.findWellById(req.body.idWell, req.decoded.idUser)
        .then(well => {
            if (well) {
                res.send(response(200, 'SUCCESSFULLY GET WELL INFOR', well));
            } else {
                res.send(response(200, 'NO WELL FOUND BY ID'));
            }
        }).catch(err => {
        res.send(response(500, 'FAILED TO FIND WELL', err));
    });
});

router.post('/well/edit', function (req, res) {
    wellModel.findWellById(req.body.idWell, req.decoded.idUser)
        .then(well => {
            if (well) {
                Object.assign(well, req.body);
                well.save().then(c => {
                    res.send(response(200, 'SUCCESSFULLY EDIT WELL', c));
                }).catch(e => {
                    res.send(response(500, 'FAILED TO EDIT WELL', e));
                })
            } else {
                res.send(response(200, 'NO WELL FOUND TO EDIT'));
            }
        }).catch(err => {
        res.send(response(500, 'FAILED TO FIND WELL', err));
    });
});

router.post('/well/delete', function (req, res) {
    wellModel.deleteWell(req.body.idWell, req.decoded.idUser, (err, rs) => {
        if(!err) res.send(response(200, 'SUCCESSFULLY DELETE WELL', rs));
        else {
            console.log(err);
            res.send(response(200, 'FAILED TO DELETE WELL: ', err));
        }
    });
});

router.post('/wells', function (req, res) {
    Well.findAll({
        where: {
            idUser: req.decoded.idUser,
         }
    })
        .then((wells) => {
            res.send(response(200, 'SUCCESSFULLY GET WELLS', wells));
        })
        .catch((err) => {
            res.send(response(500, 'FAILED TO GET WELLS', err));
        })
})

module.exports = router;
