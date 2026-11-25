const mongoose=require('mongoose');const schemas=require('./learner-account-schemas');
module.exports=Object.fromEntries(Object.entries(schemas).map(([k,[n,s]])=>[k,mongoose.models[n]||mongoose.model(n,s)]));
