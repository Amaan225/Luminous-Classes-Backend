// Bind every test-path model to the independent, named test database.
// Never change the default production connection or query production models.
function createTutorTestModels(connection){
 if(!connection||connection.name!=='tutor49_test'||connection.readyState!==1)throw Error('Connected tutor49_test database required');
 const bind=source=>connection.models[source.modelName]||connection.model(source.modelName,source.schema.clone(),source.collection.name);
 const group=schemas=>Object.fromEntries(Object.entries(schemas).map(([key,[name,schema]])=>[key,connection.models[name]||connection.model(name,schema.clone())]));
 return {
  models:group(require('./models/tutor-account-schemas')),
  alertModels:group(require('./models/tutor-alert-schemas')),
  Tutor:bind(require('./models/tutor')),
  Job:bind(require('./models/jobmodel')),
  Unlock:bind(require('./models/UnlockRequest'))
 };
}
module.exports={createTutorTestModels};
