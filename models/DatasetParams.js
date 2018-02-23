module.exports = function (sequelize, DataTypes) {
    return sequelize.define('dataset_params', {
        idDataset: {
            type: DataTypes.INTEGER,
            primaryKey: true
        },
        mnem: {
            type: DataTypes.STRING,
            primaryKey: true
        },
        value: {
            type: DataTypes.STRING,
            allowNull: false,
            defaultValue: ''
        },
        description: {
            type: DataTypes.STRING,
            defaultValue: ''
        }
    });
}