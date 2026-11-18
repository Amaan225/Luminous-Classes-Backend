const mongoose=require('mongoose');
const schemas=require('./tutor-account-schemas');
module.exports=Object.fromEntries(Object.entries(schemas).map(([key,[name,schema]])=>[key,mongoose.models[name]||mongoose.model(name,schema)]));
