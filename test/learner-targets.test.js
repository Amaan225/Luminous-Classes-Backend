const test=require('node:test');const assert=require('node:assert/strict');const {quizData}=require('../learner-routes');
const base={title:'Targets check',description:'',levels:['exam'],subjects:['Quantitative Aptitude'],topic:'',kind:'sectional',difficulty:'easy',minutes:10,marks:3,negativeMarks:0,questions:[{text:'1+1?',options:['1','2','3','4'],answer:1,explanation:'2'}]};
test('exam targets include MTS, GD and IBPS PO and still reject unknown targets',()=>{
  for(const t of ['SSC CGL','SSC CHSL','SSC MTS','SSC GD','IBPS PO','Bank PO','Other exam'])assert.deepEqual(quizData({...base,targets:[t]}).targets,[t]);
  assert.throws(()=>quizData({...base,targets:['SSC XYZ']}));
  assert.throws(()=>quizData({...base,levels:['school'],targets:['SSC MTS']}));
});
