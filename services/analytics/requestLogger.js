const crypto=require('crypto');
exports.start=(feature)=>({id:'AI-'+Date.now()+'-'+crypto.randomBytes(3).toString('hex').toUpperCase(),feature,start:Date.now()});
exports.finish=(ctx,meta={})=>({requestId:ctx.id,durationMs:Date.now()-ctx.start,...meta});
