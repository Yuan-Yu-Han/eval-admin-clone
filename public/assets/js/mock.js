/* ══════ Mock ══════ */
var _mcList=[], _curConfigId='', _mockOutputCaseList=[], _mockTemplateList=[];
function loadMockConfigs(cb){
    fetch(BASE+'/api/mock-configs').then(r=>r.json()).then(function(d){
        if(d.code==='10000') _mcList=d.data||[];
        else _mcList=[];
        // 填充所有数据集下拉
        var opts=_mcList.map(function(c){
            return '<option value="'+esc(c.configId)+'">'+esc(c.name)+'（'+(c.mockOutputCount||0)+' 条实际输出）</option>';
        }).join('');
        document.getElementById('mc-sel').innerHTML=opts;
        document.getElementById('rc-mock-config').innerHTML=opts;
        // 恢复选中或选第一个
        if(_curConfigId&&_mcList.find(function(c){return c.configId===_curConfigId;})){
            document.getElementById('mc-sel').value=_curConfigId;
        }else if(_mcList.length){
            _curConfigId=_mcList[0].configId;
        }
        if(cb) cb();
    }).catch(function(){});
}
function switchMockConfig(){
    _curConfigId=document.getElementById('mc-sel').value;
    loadMockDetail();
}
function loadMock(){
    loadMockConfigs(function(){
        loadMockDetail();
        loadMockTemplates(function(){ loadMockOutputCases(); });
    });
}
function loadMockTemplates(cb){
    if(typeof allCaseTemplates==='function'){
        allCaseTemplates().then(function(list){_mockTemplateList=list||[];if(cb)cb();}).catch(function(){_mockTemplateList=[];if(cb)cb();});
        return;
    }
    fetch(BASE+'/api/templates').then(function(r){return r.json();}).then(function(d){
        _mockTemplateList=(d.code==='10000'&&d.data&&d.data.templates)||[];
        if(cb) cb();
    }).catch(function(){_mockTemplateList=[];if(cb)cb();});
}
function loadMockDetail(){
    var cid=_curConfigId;
    var qs=cid?'?configId='+encodeURIComponent(cid):'';
    fetch(BASE+'/api/mock-config'+qs).then(r=>r.json()).then(function(d){
        var cfg=d.data;
        if(!cfg){document.getElementById('k-mo').textContent='0';document.getElementById('k-mu').textContent='0';return;}
        var summary=(_mcList.find(function(c){return c.configId===cfg.configId;})||{});
        var ko=document.getElementById('k-mo');
        if(ko) ko.textContent=summary.mockOutputCount||Object.keys(cfg.mockOutputs||{}).length||0;
        updateMockOutputKpis();
        loadMockOutputForCase();
    });
}
function loadMockOutputCases(){
    fetch(BASE+'/api/cases').then(function(r){return r.json();}).then(function(d){
        var sel=document.getElementById('mock-output-case');
        if(!sel||d.code!=='10000') return;
        _mockOutputCaseList=filterItemsForActiveProject(d.data||[]);
        sel.innerHTML=_mockOutputCaseList.map(function(c){return '<option value="'+ea(c.id)+'">'+esc((c.caseId||c.id)+' · '+(c.template_id||c.templateId||'未选模板'))+'</option>';}).join('');
        updateMockOutputKpis();
        loadMockOutputForCase();
    }).catch(function(){});
}
function updateMockOutputKpis(){
    var total=(_mockOutputCaseList||[]).length;
    var summary=(_mcList.find(function(c){return c.configId===_curConfigId;})||{});
    var configured=Number(summary.mockOutputCount||0);
    var kc=document.getElementById('k-mc');
    var ko=document.getElementById('k-mo');
    var ku=document.getElementById('k-mu');
    if(kc) kc.textContent=total;
    if(ko) ko.textContent=configured;
    if(ku) ku.textContent=Math.max(0,total-configured);
}
function selectedMockOutputCaseId(){
    return (document.getElementById('mock-output-case')||{}).value||'';
}
function loadMockOutputForCase(){
    var caseId=selectedMockOutputCaseId();
    var ta=document.getElementById('mock-output-json');
    if(!ta||!caseId||!_curConfigId) return;
    renderMockOutputContext();
    fetch(BASE+'/api/mock-configs/'+encodeURIComponent(_curConfigId)+'/outputs/'+encodeURIComponent(caseId))
    .then(function(r){return r.json();}).then(function(d){
        var data=d.code==='10000'?d.data:null;
        var status=document.getElementById('mock-output-status');
        var hasData=!!(data&&Object.keys(data).length);
        if(status) status.innerHTML=hasData?'<span style="color:var(--c-green);font-weight:700">已配置实际输出</span>':'<span style="color:var(--c-amber);font-weight:700">未配置实际输出，Run 会用空输出导致相关检查失败</span>';
        if(!hasData) data=mockOutputExampleForSelectedCase();
        setMockOutputForm(data);
    }).catch(function(){});
}
function selectedMockOutputCase(){
    var id=selectedMockOutputCaseId();
    return (_mockOutputCaseList||[]).find(function(c){return c.id===id||c.caseId===id;})||null;
}
function mockTemplateForCase(c){
    var id=(c&& (c.template_id||c.templateId)) || '';
    return (_mockTemplateList||[]).find(function(t){return t.templateId===id;})||null;
}
function mockExpectedLabels(t){
    var labels={};
    (t&&t.stages||[]).forEach(function(stage){
        if(stage.eval_type==='structure_match'&&stage.method!=='json_path_exists') labels[stage.key]=stage.case_field_label||stage.name||'期望值';
        if(stage.eval_type==='text_match'){
            if(stage.method==='contains'||stage.method==='contains_and_not_contains') labels[stage.key+'_contains']=stage.case_include_label||((stage.name||'回复检查')+' 必须包含');
            if(stage.method==='contains_and_not_contains') labels[stage.key+'_not_contains']=stage.case_exclude_label||((stage.name||'回复检查')+' 不能包含');
            if(stage.method==='exact_match') labels[stage.key+'_exact']=stage.case_exact_label||((stage.name||'回复检查')+' 期望完整文本');
            if(stage.method==='regex_match') labels[stage.key+'_regex']=stage.case_regex_label||((stage.name||'回复检查')+' 正则规则');
        }
    });
    return labels;
}
function renderMockOutputContext(){
    var box=document.getElementById('mock-output-context');
    if(!box) return;
    var c=selectedMockOutputCase();
    if(!c){box.innerHTML='<div class="empty">请选择 Case。</div>';return;}
    var t=mockTemplateForCase(c);
    var expected=c.expected||{};
    var labels=mockExpectedLabels(t);
    var keys=Object.keys(expected).filter(function(k){return expected[k]!==undefined&&expected[k]!==null&&String(expected[k]).trim()!=='';});
    var expectedHtml=keys.length?keys.map(function(k){
        return '<div><span>'+esc(labels[k]||k)+'</span><b>'+esc(typeof expected[k]==='object'?JSON.stringify(expected[k]):expected[k])+'</b></div>';
    }).join(''):'<p style="color:var(--c-text3)">这个 Case 还没有填写期望内容。</p>';
    var input=c.input1||((c.turns||[])[0]&&c.turns[0].userInput)||'';
    box.innerHTML='<div class="mock-output-panel">'+
        '<h4>当前 Case</h4>'+
        '<p><b>'+esc(c.caseId||c.id||'')+'</b></p>'+
        '<p style="margin-top:6px">'+esc(input||'暂无用户输入')+'</p>'+
        '<p style="margin-top:8px;color:var(--c-text2)">评测模板：<b>'+esc((t&&t.name)||(c.template_id||c.templateId)||'未选择模板')+'</b></p>'+
        '</div>'+
        '<div class="mock-output-panel">'+
        '<h4>Case 期望</h4>'+
        '<div class="mock-output-expected">'+expectedHtml+'</div>'+
        '</div>';
}
function setMockOutputForm(data){
    data=data||{};
    var fn=document.getElementById('mock-actual-function');
    var args=document.getElementById('mock-actual-arguments');
    var reply=document.getElementById('mock-actual-reply');
    var json=document.getElementById('mock-output-json');
    if(fn) fn.value=data.function_name||data.actualTool||data.tool||'';
    if(args) args.value=data.arguments!==undefined?JSON.stringify(data.arguments,null,2):(data.args!==undefined?JSON.stringify(data.args,null,2):'');
    if(reply) reply.value=data.final_reply||data.reply||data.llmReplyText||'';
    if(json) json.value=JSON.stringify(data,null,2);
}
function collectMockOutputPayload(){
    var jsonEl=document.getElementById('mock-output-json');
    var payload={};
    if(jsonEl&&jsonEl.value.trim()){
        try{payload=JSON.parse(jsonEl.value||'{}');}catch(e){throw new Error('高级 JSON 格式错误');}
    }
    var fn=(document.getElementById('mock-actual-function')||{}).value||'';
    var argsText=(document.getElementById('mock-actual-arguments')||{}).value||'';
    var reply=(document.getElementById('mock-actual-reply')||{}).value||'';
    if(fn.trim()) payload.function_name=fn.trim(); else delete payload.function_name;
    if(argsText.trim()){
        try{payload.arguments=JSON.parse(argsText);}catch(e){throw new Error('实际参数 JSON 格式错误');}
    }else delete payload.arguments;
    if(reply.trim()) payload.final_reply=reply.trim(); else delete payload.final_reply;
    return payload;
}
function mockOutputExampleForSelectedCase(){
    var c=selectedMockOutputCase()||{};
    var expected=c.expected||{};
    var fn=expected.functionInvocation||expected.intent||'open_door';
    var args=expected.inputConditionRetention||expected.agentIntermediateCall||'';
    var parsedArgs={door_position:'left_front',confirmed:true};
    if(args){
        try{parsedArgs=JSON.parse(args);}catch(e){parsedArgs={value:args};}
    }
    var reply=expected.replyFaithfulness_contains||expected.replyFaithfulness_exact||expected.replyFaithfulness||'已按要求处理完成。';
    if(String(reply).indexOf('\n')>=0) reply=String(reply).split(/\n/)[0];
    return {function_name:fn,arguments:parsedArgs,final_reply:reply};
}
function fillMockOutputExample(){
    setMockOutputForm(mockOutputExampleForSelectedCase());
}
function saveMockOutputForCase(){
    var caseId=selectedMockOutputCaseId();
    if(!caseId||!_curConfigId){toast('请先选择 Case 和数据集','err');return;}
    var payload;
    try{payload=collectMockOutputPayload();}catch(e){toast(e.message||'实际输出格式错误','err');return;}
    fetch(BASE+'/api/mock-configs/'+encodeURIComponent(_curConfigId)+'/outputs/'+encodeURIComponent(caseId),{
        method:'PUT',
        headers:{'Content-Type':'application/json'},
        body:JSON.stringify(payload)
    }).then(function(r){return r.json();}).then(function(d){
        if(d.code==='10000'){
            toast('Mock 实际输出已保存','ok');
            loadMockConfigs(function(){loadMockDetail();});
        }
        else toast('保存失败: '+(d.message||''),'err');
    }).catch(function(){toast('保存请求失败','err');});
}
function createMockConfig(){
    var name=prompt('输入数据集名称:');
    if(!name||!name.trim())return;
    fetch(BASE+'/api/mock-configs',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:name.trim()})})
    .then(r=>r.json()).then(function(d){
        if(d.code==='10000'){_curConfigId=d.data.configId;toast('已创建','ok');loadMock();}else toast(d.message,'err');
    });
}
function cloneMockConfig(){
    if(!_curConfigId){toast('请先选择数据集','err');return;}
    var cur=_mcList.find(function(c){return c.configId===_curConfigId;});
    var name=prompt('克隆数据集名称:', (cur?cur.name:'')+'_copy');
    if(!name||!name.trim())return;
    fetch(BASE+'/api/mock-configs',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:name.trim(),cloneFrom:_curConfigId})})
    .then(r=>r.json()).then(function(d){
        if(d.code==='10000'){_curConfigId=d.data.configId;toast('已克隆','ok');loadMock();}else toast(d.message,'err');
    });
}
function renameMockConfig(){
    if(!_curConfigId){return;}
    var cur=_mcList.find(function(c){return c.configId===_curConfigId;});
    var name=prompt('重命名:', cur?cur.name:'');
    if(!name||!name.trim())return;
    fetch(BASE+'/api/mock-configs/'+encodeURIComponent(_curConfigId)+'/name',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:name.trim()})})
    .then(r=>r.json()).then(function(d){
        if(d.code==='10000'){toast('已重命名','ok');loadMock();}else toast(d.message,'err');
    });
}
function deleteMockConfig(){
    if(!_curConfigId){return;}
    if(!confirm('确定删除该数据集？'))return;
    fetch(BASE+'/api/mock-configs/'+encodeURIComponent(_curConfigId),{method:'DELETE'})
    .then(r=>r.json()).then(function(d){
        if(d.code==='10000'){_curConfigId='';toast('已删除','ok');loadMock();}else toast(d.message,'err');
    });
}
/* ══════ Utils ══════ */
function ft(v){ if(!v)return '-'; var d; if(typeof v==='number'){d=new Date(v<1e12?v*1000:v);}else{d=new Date(v);} return isNaN(d)?String(v):d.toLocaleString('zh-CN',{year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit'}); }
function fd(ms){ if(!ms||ms<=0)return '-'; if(ms<1000)return ms+'ms'; var s=Math.round(ms/1000); if(s<60)return s+'s'; return Math.floor(s/60)+'m'+(s%60)+'s'; }
function esc(s){ if(!s)return ''; return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
function fmtJson(s){ if(!s)return ''; try{return JSON.stringify(JSON.parse(s),null,2);}catch(e){return s;} }
function fmtNum(v){
    var n=Number(v);
    if(!isFinite(n)) return '0.0';
    return (Math.round(n*10)/10).toFixed(1);
}
function clamp(v,min,max){ return Math.max(min,Math.min(max,v)); }
function scoreToVerdict(score){
    var s=Number(score)||0;
    if(s>=90) return {label:'结论：优秀',color:'var(--c-green)',bg:'var(--c-green-bg)'};
    if(s>=75) return {label:'结论：达标',color:'var(--c-blue)',bg:'var(--c-blue-bg)'};
    if(s>=60) return {label:'结论：需关注',color:'var(--c-amber)',bg:'var(--c-amber-bg)'};
    return {label:'结论：风险高',color:'var(--c-red)',bg:'var(--c-red-bg)'};
}
function judgeRiskByDims(dims){
    var minDim=Math.min(dims.accuracy,dims.completeness,dims.helpfulness,dims.safety);
    if(dims.safety<3.5||minDim<3.0) return {label:'风险：高',color:'var(--c-red)',bg:'var(--c-red-bg)'};
    if(minDim<4.0) return {label:'风险：中',color:'var(--c-amber)',bg:'var(--c-amber-bg)'};
    return {label:'风险：低',color:'var(--c-green)',bg:'var(--c-green-bg)'};
}
function getJudgeDims(judge){
    var d=(judge&&judge.dimensions)||{};
    return {
        accuracy:clamp(Number(d.accuracy)||0,0,5),
        completeness:clamp(Number(d.completeness)||0,0,5),
        helpfulness:clamp(Number(d.helpfulness)||0,0,5),
        safety:clamp(Number(d.safety)||0,0,5)
    };
}
function dimBar(label,value){
    var pct=Math.round(clamp(value,0,5)/5*100);
    return '<div style="display:grid;grid-template-columns:70px minmax(0,1fr) 38px;align-items:center;gap:8px">'+
        '<span style="font-size:12px;color:var(--c-text2)">'+label+'</span>'+
        '<div style="height:8px;border-radius:999px;background:#eef1f5;overflow:hidden"><div style="height:100%;width:'+pct+'%;background:linear-gradient(90deg,#4f7df6,#22b07d)"></div></div>'+
        '<span class="mono" style="font-size:11px;color:var(--c-text2)">'+fmtNum(value)+'</span>'+
        '</div>';
}
function buildLlmJudgeCard(judge){
    var score=Number(judge&&judge.score)||0;
    var verdict=scoreToVerdict(score);
    var review=(judge&&judge.reason)?String(judge.reason).trim():'暂无评语';

    var h='';
    h+='<div style="border:1px solid var(--c-border);border-radius:10px;padding:12px 14px;margin-bottom:10px;background:#fff">';
    h+='<div style="display:flex;justify-content:space-between;gap:10px;align-items:center;flex-wrap:wrap">'+
        '<div style="font-size:12px;font-weight:700;color:var(--c-text2)">最终回复质量评分（LLM）</div>'+
        '<div style="display:flex;gap:6px;flex-wrap:wrap">'+
        '<span class="tag" style="background:'+verdict.bg+';color:'+verdict.color+';border:1px solid #e6e9ef">'+verdict.label+'</span>'+
        '</div></div>';

    h+='<div style="display:grid;grid-template-columns:132px minmax(0,1fr);gap:12px;margin-top:10px">'+
        '<div style="border:1px solid #eef0f4;border-radius:8px;padding:12px 10px;text-align:center;background:#fafbff">'+
        '<div style="font-size:11px;color:var(--c-text3)">总分</div>'+
        '<div style="font-size:30px;font-weight:800;color:var(--c-accent);line-height:1.1;margin-top:4px">'+Math.round(score)+'</div>'+
        '<div class="mono" style="font-size:10px;color:var(--c-text3)">0-100</div>'+
        '</div>'+
        '<div style="border:1px solid #edf0f5;border-radius:8px;padding:10px;background:#f8fafc">'+
        '<div style="font-size:11px;color:var(--c-text3);margin-bottom:4px">LLM评语</div>'+
        '<div style="font-size:12px;color:var(--c-text2);line-height:1.65;white-space:pre-wrap;word-break:break-word">'+esc(review)+'</div>'+
        '</div></div>';

    h+='</div>';
    return h;
}
function parseJsonObj(v){
    if(v===null||v===undefined||v==='') return null;
    if(typeof v==='object') return v;
    if(typeof v==='string'){
        try{return JSON.parse(v);}catch(e){return null;}
    }
    return null;
}
function normalizeSkillResult(skillResultJson){
    var raw=parseJsonObj(skillResultJson);
    if(!raw||typeof raw!=='object') return null;

    var data=(raw.data&&typeof raw.data==='object')?raw.data:{};
    var filter=(data.filter&&typeof data.filter==='object')?data.filter:{};
    var sections=Array.isArray(data.sections)?data.sections:[];
    var immutableKeys=Array.isArray(raw.immutableKeys)?raw.immutableKeys:[];

    return {
        skill:raw.skill||'',
        success:raw.success,
        resultType:raw.resultType||'',
        data:data,
        immutableKeys:immutableKeys,
        normalizedSlots:{
            action:data.action||'',
            city:filter.city||'',
            queryDate:filter.queryDate||'',
            scene:data.scene||'',
            llmMessage:data.llmMessage||'',
            sectionsCount:sections.length,
            errorCode:data.errorCode||'',
            errorLabel:data.errorLabel||''
        }
    };
}
function formatStandardSkillResult(skillResultJson){
    var normalized=normalizeSkillResult(skillResultJson);
    if(!normalized) return '';
    return JSON.stringify(normalized,null,2);
}
function fmtSkillSlotSummary(skillResultJson){
    var normalized=normalizeSkillResult(skillResultJson);
    if(!normalized||!normalized.normalizedSlots) return '';
    var s=normalized.normalizedSlots;
    var out=[];
    if(s.action) out.push('action='+s.action);
    if(s.city) out.push('city='+s.city);
    if(s.queryDate) out.push('queryDate='+s.queryDate);
    if(s.scene) out.push('scene='+s.scene);
    if(typeof s.sectionsCount==='number'&&s.sectionsCount>0) out.push('sections='+s.sectionsCount);
    if(s.errorCode) out.push('errorCode='+s.errorCode);
    if(s.errorLabel) out.push('errorLabel='+s.errorLabel);
    return out.join(' | ');
}
function ea(s){ if(!s)return ''; return String(s).replace(/\\/g,'\\\\').replace(/'/g,"\\'").replace(/"/g,'&quot;'); }
function simpleDiff(oldStr,newStr){
    var a=oldStr.split('\n'),b=newStr.split('\n');
    var m=a.length,n=b.length;
    // LCS table
    var dp=[];
    for(var i=0;i<=m;i++){dp[i]=[];for(var j=0;j<=n;j++)dp[i][j]=0;}
    for(var i=1;i<=m;i++)for(var j=1;j<=n;j++){
        dp[i][j]=a[i-1]===b[j-1]?dp[i-1][j-1]+1:Math.max(dp[i-1][j],dp[i][j-1]);
    }
    // backtrack
    var res=[],i=m,j=n;
    while(i>0||j>0){
        if(i>0&&j>0&&a[i-1]===b[j-1]){res.unshift({t:'eq',v:a[i-1]});i--;j--;}
        else if(j>0&&(i===0||dp[i][j-1]>=dp[i-1][j])){res.unshift({t:'add',v:b[j-1]});j--;}
        else{res.unshift({t:'del',v:a[i-1]});i--;}
    }
    return res.map(function(r){
        if(r.t==='del')return '<span class="diff-del">- '+esc(r.v)+'</span>';
        if(r.t==='add')return '<span class="diff-add">+ '+esc(r.v)+'</span>';
        return '<span class="diff-eq">  '+esc(r.v)+'</span>';
    }).join('');
}
