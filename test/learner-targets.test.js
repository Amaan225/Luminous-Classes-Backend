const test=require('node:test');const assert=require('node:assert/strict');const {quizData}=require('../learner-routes');
const base={title:'Targets check',description:'',levels:['exam'],subjects:['Quantitative Aptitude'],topic:'',kind:'sectional',difficulty:'easy',minutes:10,marks:3,negativeMarks:0,questions:[{text:'1+1?',options:['1','2','3','4'],answer:1,explanation:'2'}]};
test('exam targets include MTS, GD and IBPS PO and still reject unknown targets',()=>{
  for(const t of ['SSC CGL','SSC CHSL','SSC MTS','SSC GD','IBPS PO','UGC NET','CTET','Bank PO','Other exam'])assert.deepEqual(quizData({...base,targets:[t]}).targets,[t]);
  assert.throws(()=>quizData({...base,targets:['SSC XYZ']}));
  assert.throws(()=>quizData({...base,levels:['school'],targets:['SSC MTS']}));
});
test('UGC NET and CTET subjects are accepted',()=>{
  assert.deepEqual(quizData({...base,targets:['UGC NET'],subjects:['Teaching and Research Aptitude']}).subjects,['Teaching and Research Aptitude']);
  assert.deepEqual(quizData({...base,targets:['CTET'],subjects:['Child Development and Pedagogy']}).subjects,['Child Development and Pedagogy']);
});
test('negative marks accept exact one third but still reject other long decimals',()=>{
  assert.equal(quizData({...base,marks:1,negativeMarks:1/3,targets:['RRB NTPC']}).negativeMarks,1/3);
  assert.throws(()=>quizData({...base,marks:1,negativeMarks:0.3333,targets:['RRB NTPC']}));
  assert.throws(()=>quizData({...base,marks:1,negativeMarks:0.333,targets:['RRB NTPC']}));
});
