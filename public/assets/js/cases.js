/* ══════ Cases ══════ */
var _caseListTemplates=[];
function loadCaseListTemplates(cb){
    fetch(BASE+'/api/templates').then(function(r){return r.json();}).then(function(d){
        _caseListTemplates=(d.code==='10000'&&d.data&&d.data.templates)||[];
        if(cb) cb();
    }).catch(function(){ if(cb) cb(); });
}
function loadCases(){
    loadCaseListTemplates(function(){
        fetch(BASE+'/api/cases').then(r=>r.json()).then(d=>{
            if(d.code==='10000'){ allCases=filterItemsForActiveProject(d.data||[]); updKpi(); filterCases(); renderWorkspaceHome(); }
            else toast('加载失败: '+d.message,'err');
        }).catch(e=>toast('请求异常','err'));
    });
}
function activeProjectId(){
    return localStorage.getItem(PROJECT_ID_KEY)||((activeWorkspaceProject()||{}).projectId)||'';
}
function filterItemsForActiveProject(items){
    var projectId=activeProjectId();
    if(!projectId||projectId==='all') return items||[];
    return (items||[]).filter(function(item){return !item.projectId||item.projectId===projectId;});
}
function caseTypeForProjectId(projectId){
    return projectId==='voice-ticket-eval'?'voice_ticket_dialogue':'vehicle_agent_turns';
}
var _allToolNames=[];
function updKpi(){
    document.getElementById('k-total').textContent=allCases.length;
    document.getElementById('k-enabled').textContent=allCases.filter(c=>c.enabled).length;
    // populate tool filter dropdown
    var sel=document.getElementById('case-tool-filter');
    var prev=sel.value;
    var tools=new Set();
    allCases.forEach(function(c){
        (c.turns||[]).forEach(function(t){if(t.expectedTool)tools.add(t.expectedTool);});
        collectCaseEvalSlots(c).forEach(function(slot){
            if(canonicalEvalType(slot.evalType)==='structure_match'){
                var arg=parseExpectedArg(slot.expectedArg);
                if(arg&&arg.tool) tools.add(arg.tool);
                else if(slot.expectedArg) tools.add(slot.expectedArg);
            }
        });
    });
    _allToolNames=Array.from(tools).sort();
    sel.innerHTML='<option value="">全部函数</option>'+_allToolNames.map(function(t){return '<option value="'+esc(t)+'">'+esc(t)+'</option>';}).join('');
    sel.value=prev;
    loadRegressionTabs();
    // populate group tabs
    loadGroups();
}
var _activeGroup='';
var _activeRegression='';
var GROUP_TAB_LIMIT=6;
function loadRegressionTabs(){
    var tabs=document.getElementById('regression-tabs');
    if(!tabs) return;
    var total=allCases.length;
    var reg=allCases.filter(function(c){return c.regression;}).length;
    var nonReg=total-reg;
    var html='';
    html+='<div class="nav-item'+(_activeRegression===''?' active':'')+'" onclick="switchRegression(\'\')">全部 ('+total+')</div>';
    html+='<div class="nav-item'+(_activeRegression==='reg'?' active':'')+'" onclick="switchRegression(\'reg\')">回归集 ('+reg+')</div>';
    html+='<div class="nav-item'+(_activeRegression==='non-reg'?' active':'')+'" onclick="switchRegression(\'non-reg\')">非回归集 ('+nonReg+')</div>';
    tabs.innerHTML=html;
}
function switchRegression(v){
    _activeRegression=v;
    filterCases();
    loadRegressionTabs();
}
function loadGroups(){
    fetch(BASE+'/api/groups').then(r=>r.json()).then(function(d){
        if(d.code!=='10000') return;
        var groups=d.data||[];
        var tabs=document.getElementById('group-tabs');
        var ddWrap=document.getElementById('group-dropdown-wrap');
        var counts={};
        allCases.forEach(function(c){var g=c.groupName||'默认分组';counts[g]=(counts[g]||0)+1;});
        var total=allCases.length;

        if(groups.length<=GROUP_TAB_LIMIT){
            tabs.style.display='flex'; ddWrap.style.display='none';
            var html='<div class="nav-item'+(_activeGroup===''?' active':'')+'" onclick="switchGroup(\'\')">全部 ('+total+')</div>';
            groups.forEach(function(g){
                var cnt=counts[g]||0;
                html+='<div class="nav-item'+(_activeGroup===g?' active':'')+'" onclick="switchGroup(\''+ea(g)+'\')" style="display:inline-flex;align-items:center;gap:6px">'+esc(g)+' ('+cnt+')'
                    +'<span onclick="event.stopPropagation();deleteGroup(\''+ea(g)+'\','+cnt+')" style="cursor:pointer;font-size:12px;color:#999;margin-left:2px" title="删除分组">&times;</span></div>';
            });
            tabs.innerHTML=html;
        } else {
            tabs.style.display='none'; ddWrap.style.display='block';
            var label=_activeGroup?(_activeGroup+' ('+( counts[_activeGroup]||0)+')'):'全部 ('+total+')';
            document.getElementById('group-dropdown-label').textContent=label;
            var list=document.getElementById('group-dropdown-list');
            var html='<div class="group-dropdown-item'+(_activeGroup===''?' active':'')+'" onclick="switchGroup(\'\')">全部<span class="count">'+total+'</span></div>';
            groups.forEach(function(g){
                var cnt=counts[g]||0;
                html+='<div class="group-dropdown-item'+(_activeGroup===g?' active':'')+'" onclick="switchGroup(\''+ea(g)+'\')">'
                    +esc(g)+'<span style="display:flex;align-items:center;gap:6px"><span class="count">'+cnt+'</span>'
                    +'<span class="del-x" onclick="event.stopPropagation();deleteGroup(\''+ea(g)+'\','+cnt+')" title="删除分组">&times;</span></span></div>';
            });
            list.innerHTML=html;
        }
    }).catch(function(){});
}
function toggleGroupDropdown(){
    var list=document.getElementById('group-dropdown-list');
    var arrow=document.getElementById('group-dropdown-arrow');
    var open=list.classList.toggle('open');
    arrow.classList.toggle('open',open);
    if(open){
        var close=function(e){
            if(!document.getElementById('group-dropdown-wrap').contains(e.target)){
                list.classList.remove('open'); arrow.classList.remove('open');
                document.removeEventListener('click',close);
            }
        };
        setTimeout(function(){document.addEventListener('click',close);},0);
    }
}
function switchGroup(g){
    _activeGroup=g;
    var list=document.getElementById('group-dropdown-list');
    if(list) { list.classList.remove('open'); var arr=document.getElementById('group-dropdown-arrow'); if(arr) arr.classList.remove('open'); }
    filterCases();
    loadGroups();
}
function deleteGroup(g,cnt){
    if(!confirm('确定删除分组「'+g+'」吗？\n\n该分组下的 '+cnt+' 条用例将一并删除，此操作不可恢复。')) return;
    fetch(BASE+'/api/groups/'+encodeURIComponent(g),{method:'DELETE'}).then(r=>r.json()).then(function(d){
        if(d.code==='10000'){toast('已删除分组「'+g+'」及 '+d.data+' 条用例','ok');_activeGroup='';loadCases();}
        else toast('删除失败：'+(d.message||''),'err');
    }).catch(function(){toast('删除请求失败','err');});
}
var filteredCases=[];
function filterCases(){
    var q=document.getElementById('case-q').value.toLowerCase();
    var tf=document.getElementById('case-tool-filter').value;
    var sf=document.getElementById('case-source-filter').value;
    var regf=_activeRegression;
    var gf=_activeGroup;
    filteredCases=allCases.filter(function(c){
        if(gf){
            var cg=c.groupName||'默认分组';
            if(cg!==gf) return false;
        }
        if(q){
            var match=false;
            if((c.caseId||'').toLowerCase().includes(q)) match=true;
            if(!match&&(c.name||'').toLowerCase().includes(q)) match=true;
            if(!match&&((c.groupName||'')+' '+(c.tags||'')).toLowerCase().includes(q)) match=true;
            if(!match&&caseInputs(c).join('\n').toLowerCase().includes(q)) match=true;
            if(!match&&collectCaseEvalSlots(c).map(function(s){return [s.evalType,s.expectedArg,s.judgePromptId].join(' ');}).join('\n').toLowerCase().includes(q)) match=true;
            if(!match&&((c.payload&&c.payload.dialogueText)||'').toLowerCase().includes(q)) match=true;
            if(!match){var turns=c.turns||[];for(var i=0;i<turns.length;i++){if((turns[i].userInput||'').toLowerCase().includes(q)){match=true;break;}}}
            if(!match) return false;
        }
        if(tf){
            var hasT=false;
            var turns=c.turns||[];
            for(var i=0;i<turns.length;i++){if(turns[i].expectedTool===tf){hasT=true;break;}}
            if(!hasT){
                collectCaseEvalSlots(c).forEach(function(slot){
                    var arg=parseExpectedArg(slot.expectedArg);
                    if(canonicalEvalType(slot.evalType)==='structure_match'&&((arg&&arg.tool===tf)||slot.expectedArg===tf)) hasT=true;
                });
            }
            if(!hasT) return false;
        }
        if(sf&&c.source!==sf) return false;
        if(regf==='reg'&&!c.regression) return false;
        if(regf==='non-reg'&&c.regression) return false;
        return true;
    });
    var btn=document.getElementById('btn-run-all');
    var cnt=filteredCases.filter(function(c){return c.enabled;}).length;
    var hasFilter=q||tf||gf||sf||regf;
    btn.textContent='运行全部'+(hasFilter?' ('+cnt+')':'');
    renderCases(filteredCases);
}
function sourceLabel(source){
    return {
        'manual':'人工',
        'llm':'LLM'
    }[source]||'人工';
}
function sourceStyle(source){
    return {
        'manual':'background:var(--c-blue-bg);color:var(--c-blue)',
        'llm':'background:#ede9fe;color:#6d28d9'
    }[source]||'background:var(--c-blue-bg);color:var(--c-blue)';
}
function activeCaseType(){
    return (_caseGenerationSchema&&_caseGenerationSchema.caseType)||caseTypeForProjectId(activeProjectId())||'vehicle_agent_turns';
}
function activeStageDefinitions(){
    var schema=_caseGenerationSchema||{};
    if(Array.isArray(schema.stageDefinitions)&&schema.stageDefinitions.length) return schema.stageDefinitions;
    if(activeCaseType()==='voice_ticket_dialogue'){
        return [
            {key:'asrTranscription',label:'ASR 转写',shortLabel:'ASR',evalTypes:['text_match'],resultKeys:['dialogueGrounding']},
            {key:'fieldExtraction',label:'字段抽取',shortLabel:'字段',evalTypes:['structure_match'],resultKeys:['fieldAccuracy','missingFieldDetection']},
            {key:'ticketStructure',label:'工单结构生成',shortLabel:'工单',evalTypes:['structure_match'],resultKeys:['routeAccuracy','noHallucination']},
            {key:'semanticQuality',label:'语义质量',shortLabel:'语义',evalTypes:['llm_judge'],resultKeys:['dialogueGrounding','noHallucination']}
        ];
    }
    return [
        {key:'intent',label:'意图识别',shortLabel:'意图',evalTypes:['structure_match'],resultKeys:['intent','route']},
        {key:'functionInvocation',label:'工具选择',shortLabel:'工具',evalTypes:['structure_match'],resultKeys:['functionInvocation','route']},
        {key:'inputConditionRetention',label:'参数提取',shortLabel:'参数',evalTypes:['structure_match'],resultKeys:['inputConditionRetention','input','skillResultContract','skillResult']},
        {key:'replyFaithfulness',label:'回复生成',shortLabel:'回复',evalTypes:['text_match'],resultKeys:['replyFaithfulness','render']},
        {key:'responseQuality',label:'语义质量',shortLabel:'语义',evalTypes:['llm_judge'],resultKeys:['responseQuality']}
    ];
}
function stageDependencyLabel(stage){
    return '';
}
var CASE_EVAL_TYPES=[
    {value:'',label:'未配置'},
    {value:'structure_match',label:'字段检查'},
    {value:'text_match',label:'回复检查'},
    {value:'llm_judge',label:'LLM 评审'}
];
function evalTypeLabel(v){
    var aliases={tool_call:'字段检查',param_match:'字段检查',reply_match:'回复检查'};
    if(aliases[v]) return aliases[v];
    for(var i=0;i<CASE_EVAL_TYPES.length;i++){if(CASE_EVAL_TYPES[i].value===v)return CASE_EVAL_TYPES[i].label;}
    return v||'未配置';
}
function canonicalEvalType(v){
    if(v==='tool_call'||v==='param_match') return 'structure_match';
    if(v==='reply_match') return 'text_match';
    return v||'';
}
function parseExpectedArg(value){
    if(!value) return null;
    if(typeof value==='object') return value;
    try{return JSON.parse(String(value));}catch(e){return null;}
}
function expectedArgText(value){
    if(value===undefined||value===null) return '';
    if(typeof value==='string') return value;
    try{return JSON.stringify(value);}catch(e){return String(value);}
}
function expectedArgPlainText(value){
    if(value===undefined||value===null) return '';
    if(typeof value==='string'){
        var parsed=parseExpectedArg(value);
        if(parsed&&typeof parsed==='object') return expectedArgPlainText(parsed);
        return value;
    }
    if(Array.isArray(value)) return value.map(function(item){return expectedArgPlainText(item);}).filter(Boolean).join('|');
    if(typeof value==='object'){
        var parts=[];
        Object.keys(value).forEach(function(key){
            var v=value[key];
            if(v===undefined||v===null||v==='') return;
            if(Array.isArray(v)) parts.push(key+'='+v.map(function(item){return expectedArgPlainText(item);}).filter(Boolean).join('|'));
            else if(typeof v==='object'){
                var nested=expectedArgPlainText(v);
                if(nested) parts.push(key+'.'+nested.replace(/, /g, ', '+key+'.'));
            }else parts.push(key+'='+String(v));
        });
        return parts.join(', ');
    }
    return String(value);
}
function caseInputs(c){
    var inputs=[c.input1,c.input2,c.input3].map(function(v){return String(v||'').trim();});
    if(inputs.some(Boolean)) return inputs;
    if(c.payload&&c.payload.dialogueText) return [String(c.payload.dialogueText||''),'',''];
    var turns=c.turns||[];
    return [0,1,2].map(function(i){return String((turns[i]&&turns[i].userInput)||'').trim();});
}
function firstInputSummary(c){
    var inputs=caseInputs(c).filter(Boolean);
    if(!inputs.length) return '<span style="color:var(--c-text3)">无输入</span>';
    return inputs.map(function(v,i){
        return '<div class="case-turn"><span class="case-turn-n">'+(i+1)+'</span><span class="case-turn-text">'+esc(v)+'</span></div>';
    }).join('');
}
function collectCaseEvalSlots(c){
    var slots=[];
    var stageEvals=[];
    (c.turns||[]).forEach(function(turn,turnIdx){
        (turn.evaluations||[]).forEach(function(ev){
            if(ev&&ev.evalType) stageEvals.push({
                index:turnIdx+1,
                evalType:ev.evalType,
                expectedArg:ev.expected||'',
                judgePromptId:ev.stageKey==='responseQuality'?(ev.promptKey||'agent-semantic-eval-prompt'):'',
                stageKey:ev.stageKey
            });
        });
    });
    var hasFlat=false;
    for(var i=1;i<=3;i++){
        if(c['eval_type_'+i]||c['expected_arg_'+i]||c['judge_prompt_id_'+i]) hasFlat=true;
    }
    if(hasFlat){
        for(var n=1;n<=3;n++){
            var et=c['eval_type_'+n]||'';
            var eaVal=c['expected_arg_'+n];
            var jp=c['judge_prompt_id_'+n]||'';
            if(et||eaVal||jp) slots.push({index:n,evalType:et,expectedArg:expectedArgText(eaVal),judgePromptId:jp});
        }
        return slots;
    }
    if(stageEvals.length) return stageEvals;
    var payload=c.payload||{};
    var ticket=payload.expectedTicket||{};
    if(payload.dialogueText||Object.keys(ticket).length){
        if(Object.keys(ticket).length){
            slots.push({index:1,evalType:'structure_match',expectedArg:expectedArgText(ticket),judgePromptId:''});
        }
        if(Array.isArray(ticket.missingFields)&&ticket.missingFields.length){
            slots.push({index:2,evalType:'structure_match',expectedArg:expectedArgText({missingFields:ticket.missingFields,mustNotInvent:ticket.missingFields}),judgePromptId:''});
        }
        slots.push({index:3,evalType:'llm_judge',expectedArg:expectedArgText({threshold:0.8}),judgePromptId:'voice_ticket_structuring_v1'});
        return slots.slice(0,3);
    }
    var turn=(c.turns||[]).find(function(t){return t.expectedTool||t.expectedArgs||(t.replyContains||[]).length||(t.replyNotContains||[]).length||t.judgePrompt||t.judgeThreshold;})||{};
    if(turn.expectedTool||turn.expectedArgs){
        slots.push({index:1,evalType:'structure_match',expectedArg:turn.expectedTool||expectedArgText({tool:turn.expectedTool||'',args:parseExpectedArg(turn.expectedArgs)||turn.expectedArgs||{}}),judgePromptId:''});
    }
    if((turn.replyContains||[]).length||(turn.replyNotContains||[]).length){
        slots.push({index:2,evalType:'text_match',expectedArg:(turn.replyContains||[]).join('|')||expectedArgText({contains:turn.replyContains||[],notContains:turn.replyNotContains||[]}),judgePromptId:''});
    }
    if(turn.judgePrompt||turn.judgeThreshold){
        slots.push({index:3,evalType:'llm_judge',expectedArg:expectedArgText({threshold:turn.judgeThreshold||turn.judgePassThreshold||0.8,criteria:turn.judgePrompt||''}),judgePromptId:''});
    }
    return slots.slice(0,3);
}
function renderEvalSummary(c){
    var slots=collectCaseEvalSlots(c);
    if(!slots.length) return '<span class="eval-chip muted">未配置</span>';
    return '<div class="eval-summary">'+slots.map(function(slot){
        var arg=parseExpectedArg(slot.expectedArg);
        var detail='';
        var type=canonicalEvalType(slot.evalType);
        if(type==='structure_match'&&arg&&arg.tool) detail=' · '+arg.tool;
        else if(type==='structure_match'&&arg) detail=' · '+Object.keys(arg).slice(0,3).join(',');
        else if(type==='structure_match'&&slot.expectedArg) detail=' · '+slot.expectedArg;
        else if(type==='text_match'&&arg) detail=' · '+((arg.contains||[]).length)+' 包含 / '+((arg.notContains||[]).length)+' 禁含';
        else if(type==='text_match'&&slot.expectedArg) detail=' · '+slot.expectedArg;
        else if(type==='llm_judge'&&slot.judgePromptId) detail=' · '+slot.judgePromptId;
        return '<span class="eval-chip">'+esc(slot.index+'. '+evalTypeLabel(slot.evalType)+detail)+'</span>';
    }).join('')+'</div>';
}
function renderCaseStageSummary(c){
    var stages=activeStageDefinitions();
    var slots=collectCaseEvalSlots(c);
    var stageHtml=stages.map(function(stage,idx){
        var matched=slots.filter(function(slot){
            if(slot.stageKey) return slot.stageKey===stage.key;
            var type=canonicalEvalType(slot.evalType);
            if((stage.evalTypes||[]).indexOf(type)===-1) return false;
            if(activeCaseType()==='voice_ticket_dialogue') return true;
            if(stage.key==='intent'||stage.key==='functionInvocation'){
                var arg=parseExpectedArg(slot.expectedArg);
                return type==='structure_match'&&(!arg||arg.tool||idx<2);
            }
            if(stage.key==='inputConditionRetention') return type==='structure_match';
            return true;
        });
        var state=matched.length?'configured':'muted';
        var detail=matched.length?matched.map(function(slot){return evalTypeLabel(slot.evalType);}).filter(Boolean).join('/'):'未配置';
        return '<span class="eval-chip '+(state==='muted'?'muted':'')+'" title="'+ea((stage.description||'')+'｜'+stageDependencyLabel(stage))+'">'+
            esc((idx+1)+'. '+(stage.shortLabel||stage.label)+' · '+detail)+
            '</span>';
    }).join('');
    return '<div class="eval-summary">'+stageHtml+'</div>';
}
function templateById(templateId){
    return _caseListTemplates.find(function(t){return t.templateId===templateId;})||null;
}
function templateNameForCase(c){
    var templateId=c.template_id||c.templateId||'';
    var t=templateById(templateId);
    if(!templateId) return '<span style="color:var(--c-text3)">未选择</span>';
    if(!t) return '<span class="tag" style="background:#f3f4f6;color:var(--c-text2)">'+esc(templateId)+'</span>';
    var count=(t.stages||[]).length;
    return '<div style="display:grid;gap:4px"><strong style="font-size:13px">'+esc(t.name||templateId)+'</strong><span style="font-size:12px;color:var(--c-text3)">'+count+' 个检查点</span></div>';
}
function templateExpectedLabels(t){
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
function renderCaseExpected(c){
    var expected=c.expected||{};
    var keys=Object.keys(expected).filter(function(key){return expected[key]!==undefined&&expected[key]!==null&&String(expected[key]).trim()!=='';});
    if(!keys.length) return '<span style="color:var(--c-text3)">未填写</span>';
    var labels=templateExpectedLabels(templateById(c.template_id||c.templateId||''));
    return '<div class="case-expected-list">'+keys.map(function(key){
        var v=expected[key];
        if(Array.isArray(v)) v=v.join(', ');
        if(v&&typeof v==='object') v=JSON.stringify(v);
        return '<div><span>'+esc(labels[key]||key)+'</span><b>'+esc(String(v))+'</b></div>';
    }).join('')+'</div>';
}
function renderCasesTableHeader(){
    var head=document.getElementById('cases-head-row');
    if(!head) return;
    if(activeCaseType()==='voice_ticket_dialogue'){
        head.innerHTML='<th class="ck col-ck"><input type="checkbox" id="ck-all" onchange="toggleAll(this)"></th>'+
            '<th class="col-case">Case</th><th class="col-input">ASR 对话</th><th>Stage 链路</th><th>期望要点</th><th class="col-status">状态</th><th class="col-source">来源</th><th class="col-updated">更新时间</th><th class="col-actions"></th>';
        return;
    }
    head.innerHTML='<th class="ck col-ck"><input type="checkbox" id="ck-all" onchange="toggleAll(this)"></th>'+
        '<th class="col-case">Case ID</th><th class="col-input">用户输入</th><th class="col-template">评测模板</th><th class="col-expected">期望内容</th><th class="col-status">状态</th><th class="col-updated">更新时间</th><th class="col-actions">操作</th>';
}
function renderCases(list){
    renderCasesTableHeader();
    if(activeCaseType()==='voice_ticket_dialogue') return renderVoiceTicketCases(list);
    var tb=document.getElementById('tb-cases');
    if(!list.length){tb.innerHTML='<tr><td colspan="8" class="empty">暂无用例</td></tr>';return;}
    tb.innerHTML=list.map(function(c){
        var lastAudit=(c.regressionAudit&&c.regressionAudit.length)?c.regressionAudit[c.regressionAudit.length-1]:null;
        var auditTip=lastAudit?('最近操作: '+(lastAudit.action||'')+' / '+(lastAudit.actor||'')+' / '+ft(lastAudit.at)):'';
        var regTag=c.regression?'<span class="tag" style="background:var(--c-amber-bg);color:var(--c-amber)" title="'+esc(auditTip)+'">回归</span>':'';
        var approveBtn=c.regression
            ?'<button class="btn btn-ghost btn-sm" onclick="approveRegression(\''+c.id+'\',false)">移回归</button>'
            :'<button class="btn btn-flat btn-sm" onclick="approveRegression(\''+c.id+'\',true)">入回归</button>';
        return '<tr>'+
            '<td class="ck"><input type="checkbox" class="ccb" value="'+c.id+'" onchange="updSelected()"></td>'+
            '<td style="vertical-align:top"><div class="case-cell-scroll"><div class="mono case-cell-nowrap">'+esc(c.caseId||'')+'</div><div class="case-subline">'+esc(c.name||'未命名')+'</div></div></td>'+
            '<td class="case-turns-cell"><div class="case-input-preview">'+firstInputSummary(c)+'</div></td>'+
            '<td style="vertical-align:top"><div class="case-cell-scroll">'+templateNameForCase(c)+'</div></td>'+
            '<td style="vertical-align:top"><div class="case-cell-scroll">'+renderCaseExpected(c)+'</div></td>'+
            '<td style="vertical-align:top">'+(c.enabled?'<span class="tag tag-on">ON</span>':'<span class="tag tag-off">OFF</span>')+(regTag?' '+regTag:'')+'</td>'+
            '<td style="vertical-align:top;color:var(--c-text3);font-size:12px"><div class="case-cell-scroll case-cell-nowrap">'+ft(c.updatedAt)+'</div></td>'+
            '<td style="vertical-align:top"><div class="case-cell-scroll"><div class="case-cell-actions">'+
                            approveBtn+
              '<button class="btn btn-ghost btn-sm" onclick="editCase(\''+c.id+'\')">编辑</button>'+
              '<button class="btn btn-ghost btn-sm" style="color:var(--c-red)" onclick="delCase(\''+c.id+'\',\''+ea(c.caseId)+'\')">删除</button>'+
            '</div></div></td></tr>';
    }).join('');
    updSelected();
}
function renderVoiceTicketCases(list){
    var tb=document.getElementById('tb-cases');
    if(!list.length){tb.innerHTML='<tr><td colspan="9" class="empty">暂无用例</td></tr>';return;}
    tb.innerHTML=list.map(function(c){
        var payload=c.payload||{};
        var ticket=payload.expectedTicket||{};
        var dialogue=payload.dialogueText||'';
        var noise=Array.isArray(payload.noiseTags)?payload.noiseTags.join(', '):(c.tags||'');
        var lastAudit=(c.regressionAudit&&c.regressionAudit.length)?c.regressionAudit[c.regressionAudit.length-1]:null;
        var auditTip=lastAudit?('最近操作: '+(lastAudit.action||'')+' / '+(lastAudit.actor||'')+' / '+ft(lastAudit.at)):'';
        var regTag=c.regression?'<span class="tag" style="background:var(--c-amber-bg);color:var(--c-amber)" title="'+esc(auditTip)+'">回归</span>':'';
        var approveBtn=c.regression
            ?'<button class="btn btn-ghost btn-sm" onclick="approveRegression(\''+c.id+'\',false)">移回归</button>'
            :'<button class="btn btn-flat btn-sm" onclick="approveRegression(\''+c.id+'\',true)">入回归</button>';
        return '<tr>'+
            '<td class="ck"><input type="checkbox" class="ccb" value="'+c.id+'" onchange="updSelected()"></td>'+
            '<td style="vertical-align:top"><div class="case-title-stack"><div class="case-name-main">'+esc(c.name||c.caseId||'未命名')+'</div><div class="case-subline mono case-cell-nowrap">'+esc(c.caseId||'')+'</div><div class="case-subline">'+esc(c.groupName||'工单结构化')+(noise?' · '+esc(noise):'')+'</div></div></td>'+
            '<td style="vertical-align:top;max-width:420px"><div style="white-space:pre-wrap;line-height:1.55">'+esc(dialogue.slice(0,260))+(dialogue.length>260?'...':'')+'</div></td>'+
            '<td style="vertical-align:top"><div class="case-cell-scroll">'+renderCaseStageSummary(c)+'</div></td>'+
            '<td style="vertical-align:top">'+renderVoiceExpectedBrief(c)+'</td>'+
            '<td style="vertical-align:top">'+(c.enabled?'<span class="tag tag-on">ON</span>':'<span class="tag tag-off">OFF</span>')+(regTag?' '+regTag:'')+'</td>'+
            '<td style="vertical-align:top"><span class="tag" style="'+sourceStyle(c.source||'manual')+'">'+sourceLabel(c.source||'manual')+'</span></td>'+
            '<td style="vertical-align:top;white-space:nowrap;color:var(--c-text3);font-size:12px">'+ft(c.updatedAt)+'</td>'+
            '<td style="white-space:nowrap;vertical-align:top">'+approveBtn+
              '<button class="btn btn-ghost btn-sm" onclick="editCase(\''+c.id+'\')">编辑</button>'+
              '<button class="btn btn-ghost btn-sm" style="color:var(--c-red)" onclick="delCase(\''+c.id+'\',\''+ea(c.caseId)+'\')">删除</button>'+
            '</td></tr>';
    }).join('');
    updSelected();
}
function renderVoiceExpectedBrief(c){
    var ticket=((c.payload||{}).expectedTicket)||{};
    var missing=Array.isArray(ticket.missingFields)?ticket.missingFields:[];
    var items=[
        ticket.ticketType?['类型',ticket.ticketType]:null,
        ticket.issueType?['问题',ticket.issueType]:null,
        ticket.vehicleId?['车辆',ticket.vehicleId]:null,
        ticket.location?['地点',ticket.location]:null,
        (ticket.routeQueue||ticket.routeTo)?['路由',ticket.routeQueue||ticket.routeTo]:null,
        missing.length?['缺失',missing.join('|')]:null
    ].filter(Boolean);
    if(!items.length) return '<span style="color:var(--c-text3)">未配置</span>';
    return '<div style="display:flex;gap:6px;flex-wrap:wrap;max-width:360px">'+items.map(function(pair){
        return '<span class="tag" style="background:#f3f4f6;color:var(--c-text2)">'+esc(pair[0]+'：'+pair[1])+'</span>';
    }).join('')+'</div>';
}
function toggleAll(el){ document.querySelectorAll('.ccb').forEach(function(cb){cb.checked=el.checked;}); updSelected(); }
function selIds(){ var a=[]; document.querySelectorAll('.ccb:checked').forEach(function(cb){a.push(cb.value);}); return a; }
function selectedCaseIdLabels(){
    var selected=selIds();
    return selected.map(function(id){
        var c=allCases.find(function(item){return item.id===id||item.caseId===id;});
        return c?(c.caseId||c.id):id;
    });
}
function renderSelectedBaseIds(){
    var box=document.getElementById('pg-selected-base');
    if(!box)return;
    var ids=selectedCaseIdLabels();
    if(!ids.length){
        box.textContent='未勾选用例；定向扩写会提示先勾选。';
        return;
    }
    box.innerHTML=ids.map(function(id){return '<span class="mono">'+esc(id)+'</span>';}).join('');
}
function updSelected(){
    document.getElementById('k-selected').textContent=selIds().length;
    renderSelectedBaseIds();
}
function patchCaseFlags(caseId,payload,okMsg){
    fetch(BASE+'/api/cases/'+caseId+'/regression-flags',{
        method:'PATCH',
        headers:{'Content-Type':'application/json'},
        body:JSON.stringify(Object.assign({actor:'manual-ui'},payload))
    }).then(function(r){return r.json();}).then(function(d){
        if(d.code==='10000'){toast(okMsg,'ok');loadCases();}
        else toast('操作失败: '+(d.message||''),'err');
    }).catch(function(){toast('请求失败','err');});
}
function approveRegression(caseId,flag){
    patchCaseFlags(caseId,{regression:!!flag},flag?'已加入回归集':'已移出回归集');
}

/* -- Case modal -- */
var _caseTemplateList=[];
function loadCaseTemplateOptions(selected,cb){
    fetch(BASE+'/api/templates').then(function(r){return r.json();}).then(function(d){
        _caseTemplateList=(d.code==='10000'&&d.data&&d.data.templates)||[];
        var sel=document.getElementById('ce-template');
        if(sel){
            sel.innerHTML='<option value="">请选择评测模板</option>'+_caseTemplateList.map(function(t){
                return '<option value="'+ea(t.templateId)+'">'+esc(t.name||t.templateId)+'</option>';
            }).join('');
            sel.value=selected||'';
        }
        if(cb) cb();
    }).catch(function(){ if(cb) cb(); });
}
function selectedCaseTemplate(){
    var id=(document.getElementById('ce-template')||{}).value||'';
    return _caseTemplateList.find(function(t){return t.templateId===id;})||null;
}
function templateExpectedFieldsForTemplate(t){
    var fields=[];
    (t&&t.stages||[]).forEach(function(stage){
        if(stage.eval_type==='llm_judge') return;
        if(stage.eval_type==='structure_match'){
            if(stage.method!=='json_path_exists'){
                fields.push({key:stage.key,label:stage.case_field_label||stage.expected_content||stage.name||'期望值',type:'textarea',placeholder:stage.method==='exact_match'?'例如：open_door 或 left_front':'例如：青岛、昨天 或 小智'});
            }
            return;
        }
        if(stage.eval_type==='text_match'){
            if(stage.method==='contains'||stage.method==='contains_and_not_contains') fields.push({key:stage.key+'_contains',label:stage.case_include_label||((stage.name||'回复检查')+' 必须包含'),type:'textarea',placeholder:'例如：已打开\\n左前车门'});
            if(stage.method==='contains_and_not_contains') fields.push({key:stage.key+'_not_contains',label:stage.case_exclude_label||((stage.name||'回复检查')+' 不能包含'),type:'textarea',placeholder:'例如：失败\\n无法操作'});
            if(stage.method==='exact_match') fields.push({key:stage.key+'_exact',label:stage.case_exact_label||((stage.name||'回复检查')+' 期望完整文本'),type:'textarea',placeholder:'例如：已为你打开左前车门。'});
            if(stage.method==='regex_match') fields.push({key:stage.key+'_regex',label:stage.case_regex_label||((stage.name||'回复检查')+' 正则规则'),type:'input',placeholder:'例如：订单号[:：]?\\\\s*[A-Z0-9]{6,}'});
        }
    });
    return fields;
}
function templateExpectedFields(t){
    return templateExpectedFieldsForTemplate(t);
}
function allCaseTemplates(){
    return fetch(BASE+'/api/templates').then(function(r){return r.json();}).then(function(d){
        return (d.code==='10000'&&d.data&&d.data.templates)||[];
    }).catch(function(){
        return [];
    });
}
function templateUnionExpectedColumns(templates){
    var seen=new Set();
    var cols=[];
    (templates||[]).forEach(function(t){
        templateExpectedFieldsForTemplate(t).forEach(function(field){
            var label=String(field.label||'').trim();
            if(!label||seen.has(label)) return;
            seen.add(label);
            cols.push(label);
        });
    });
    return cols;
}
function downloadRowsAsCsv(rows,filename,message){
    var csv=rows.map(function(r){return r.map(function(c){return '"'+String(c).replace(/"/g,'""')+'"';}).join(',');}).join('\n');
    var blob=new Blob(['\uFEFF'+csv],{type:'text/csv;charset=utf-8;'});
    var a=document.createElement('a');
    a.href=URL.createObjectURL(blob);
    a.download=filename;
    a.click();
    URL.revokeObjectURL(a.href);
    toast(message||'模板已下载','ok');
}
function downloadCsvTemplate(){
    return allCaseTemplates().then(function(templates){
        var expectedCols=templateUnionExpectedColumns(templates);
        var header=['Case ID','用户输入','评测模板'].concat(expectedCols,['标签','是否启用']);
        var templateNames=(templates||[]).map(function(t){return t.name||t.templateId;});
        function valueForLabel(label,idx){
            var text=String(label||'');
            if(/意图/.test(text)) return idx===1?'打开车门':(idx===2?'查询运营数据':'回答知识问题');
            if(/函数/.test(text)) return idx===1?'open_door':(idx===2?'vehicle_operation_data_query':'');
            if(/参数|期望值/.test(text)) return idx===1?'left_front':(idx===2?'青岛, 昨天':'小智');
            if(/中间调用/.test(text)) return idx===2?'已调用运营数据查询接口':'';
            if(/必须包含|回复命中|包含/.test(text)) return idx===1?'左前车门':(idx===2?'青岛,订单量':'答案依据');
            if(/不能包含|禁止包含/.test(text)) return idx===1?'失败':(idx===2?'编造,无法查询':'不知道');
            if(/完整|全文/.test(text)) return idx===1?'已为你打开左前车门。':'';
            if(/正则/.test(text)) return '';
            return '';
        }
        function row(caseId,input,templateName,tag,idx){
            var values={
                'Case ID':caseId,
                '用户输入':input,
                '评测模板':templateName||templateNames[0]||'',
                '标签':tag,
                '是否启用':'true'
            };
            expectedCols.forEach(function(label){values[label]=valueForLabel(label,idx);});
            return header.map(function(col){return values[col]||'';});
        }
        var rows=[
            header,
            row('case_open_door_left_front','帮我打开左前车门',templateNames[1]||templateNames[0]||'指令执行评测','车控,开门',1),
            row('case_query_qingdao_orders','查一下昨天青岛的订单量',templateNames[2]||templateNames[0]||'数据查询评测','数据查询',2),
            row('case_rag_reply_quality','这个功能支持离线使用吗？',templateNames[0]||'回答质量评测','RAG,回复质量',3)
        ];
        downloadRowsAsCsv(rows,'case_template_all_template_fields.csv','已下载所有模板字段合集 CSV');
    });
}
function parseCsvRows(text){
    var rows=[], row=[], cell='', quoted=false;
    var input=String(text||'').replace(/^\uFEFF/,'');
    for(var i=0;i<input.length;i++){
        var ch=input[i], next=input[i+1];
        if(quoted){
            if(ch==='"'&&next==='"'){cell+='"';i++;}
            else if(ch==='"') quoted=false;
            else cell+=ch;
        }else if(ch==='"') quoted=true;
        else if(ch===','){row.push(cell);cell='';}
        else if(ch==='\n'){row.push(cell);rows.push(row);row=[];cell='';}
        else if(ch!=='\r') cell+=ch;
    }
    row.push(cell);
    rows.push(row);
    return rows.filter(function(r){return r.some(function(c){return String(c||'').trim();});});
}
function rowCellByHeader(row,header,name){
    var idx=header.indexOf(name);
    return idx>=0?String(row[idx]||'').trim():'';
}
function templateByCsvName(templates,name){
    var target=String(name||'').trim();
    if(!target) return null;
    return (templates||[]).find(function(t){
        return String(t.templateId||'')===target||String(t.name||'')===target;
    })||null;
}
function buildCaseFromUnionCsvRow(row,header,templates){
    var caseId=rowCellByHeader(row,header,'Case ID');
    if(!caseId||caseId.charAt(0)==='#') return null;
    var tpl=templateByCsvName(templates,rowCellByHeader(row,header,'评测模板'));
    if(!tpl) throw new Error('Case '+caseId+' 的评测模板不存在：'+rowCellByHeader(row,header,'评测模板'));
    var expected={};
    templateExpectedFieldsForTemplate(tpl).forEach(function(field){
        var label=String(field.label||'').trim();
        var value=rowCellByHeader(row,header,label);
        if(value) expected[field.key]=value;
    });
    var input=rowCellByHeader(row,header,'用户输入');
    return {
        caseId:caseId,
        name:caseId,
        template_id:tpl.templateId,
        input1:input,
        turns:input?[{turnIndex:1,userInput:input}]:[],
        expected:expected,
        tags:rowCellByHeader(row,header,'标签'),
        enabled:rowCellByHeader(row,header,'是否启用')!=='false',
        caseType:'vehicle_agent_turns',
        expectedTools:[],
        allowedTools:[]
    };
}
function importUnionTemplateCsvText(text,label,input){
    var rows=parseCsvRows(text);
    if(rows.length<2){toast('CSV 没有可导入内容','err');return Promise.resolve();}
    var header=rows[0].map(function(c){return String(c||'').trim();});
    if(header.indexOf('评测模板')<0) return null;
    return allCaseTemplates().then(function(templates){
        var docs=[];
        rows.slice(1).forEach(function(row){var doc=buildCaseFromUnionCsvRow(row,header,templates);if(doc) docs.push(doc);});
        if(!docs.length){toast('CSV 没有可导入的 Case','err');return;}
        var tip=toast('正在导入字段合集 CSV，请稍候...','info',true);
        return Promise.all(docs.map(function(doc){
            return fetch(BASE+'/api/cases',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(doc)})
                .then(function(r){return r.json();})
                .then(function(d){if(d.code!=='10000') throw new Error(d.message||'保存失败');return d.data;});
        })).then(function(){
            dismissToast(tip);
            toast('导入成功：共 '+docs.length+' 条用例','ok');
            if(typeof loadCases==='function') loadCases();
        }).catch(function(e){
            dismissToast(tip);
            toast('导入失败: '+(e&&e.message||e),'err');
        });
    }).catch(function(e){
        toast('导入失败: '+(e&&e.message||e),'err');
    });
}
function exportCases(){
    var count=filteredCases.length;
    if(count===0){toast('当前没有可导出的用例','err');return;}
    var label=_activeGroup?'「'+_activeGroup+'」分组':'全部';
    document.getElementById('ec-count').textContent=count;
    document.getElementById('ec-hint').textContent=label;
    var okBtn=document.getElementById('ec-ok');
    okBtn.onclick=function(){
        closeExportConfirm();
        var url=BASE+'/api/cases/export';
        var params=[];
        if(_activeGroup) params.push('group='+encodeURIComponent(_activeGroup));
        var sf=document.getElementById('case-source-filter').value;
        var regf=_activeRegression;
        if(sf) params.push('source='+encodeURIComponent(sf));
        if(regf==='reg') params.push('regression=true');
        if(params.length) url+='?'+params.join('&');
        var a=document.createElement('a');
        a.href=url;
        a.download='eval_cases_export.csv';
        a.click();
        toast('已导出 '+count+' 条用例','ok');
    };
    document.getElementById('ol-export-confirm').classList.add('open');
}
function closeExportConfirm(){ document.getElementById('ol-export-confirm').classList.remove('open'); }
var _importing=false;
function importCsv(input){
    if(!input.files.length||_importing)return;
    _importing=true;
    var label=input.parentElement;
    label.style.pointerEvents='none';
    label.style.opacity='0.5';
    var file=input.files[0];
    var reader=new FileReader();
    reader.onload=function(){
        var unionImport=importUnionTemplateCsvText(reader.result,label,input);
        if(unionImport){
            unionImport.finally(function(){_importing=false;label.style.pointerEvents='';label.style.opacity='';input.value='';});
            return;
        }
        importCsvViaBackend(input,file,label);
    };
    reader.onerror=function(){
        toast('读取 CSV 失败','err');
        _importing=false;
        label.style.pointerEvents='';
        label.style.opacity='';
        input.value='';
    };
    reader.readAsText(file);
}
function importCsvViaBackend(input,file,label){
    var fd=new FormData();
    fd.append('file',file||input.files[0]);
    var tip=toast('正在导入，请稍候...','info',true);
    fetch(BASE+'/api/cases/import',{method:'POST',body:fd}).then(r=>r.json()).then(d=>{
        dismissToast(tip);
        if(d.code==='10000'){toast('导入成功：共 '+d.data.imported+' 条用例','ok');loadCases();}
        else toast('导入失败: '+d.message,'err');
    }).catch(e=>{dismissToast(tip);toast('导入异常: '+e,'err');})
    .finally(function(){_importing=false;label.style.pointerEvents='';label.style.opacity='';input.value='';});
}
function populateGroupSelect(selected){
    var sel=document.getElementById('ce-group');
    fetch(BASE+'/api/groups').then(r=>r.json()).then(function(d){
        if(d.code!=='10000') return;
        var groups=d.data||[];
        sel.innerHTML=groups.map(function(g){return '<option value="'+ea(g)+'"'+(g===selected?' selected':'')+'>'+esc(g)+'</option>';}).join('');
        if(selected&&sel.value!==selected){sel.innerHTML+='<option value="'+ea(selected)+'" selected>'+esc(selected)+'</option>';}
    });
}
function createNewGroup(){
    var name=prompt('请输入新分组名称：');
    if(!name||!name.trim()) return;
    name=name.trim();
    var sel=document.getElementById('ce-group');
    var exists=false;
    for(var i=0;i<sel.options.length;i++){if(sel.options[i].value===name){exists=true;break;}}
    if(!exists){sel.innerHTML+='<option value="'+ea(name)+'">'+esc(name)+'</option>';}
    sel.value=name;
}
function openCaseModal(doc){
    document.getElementById('ce-id').value='';
    document.getElementById('ce-caseId').value='';
    document.getElementById('ce-name').value='';
    document.getElementById('ce-uid').value='';
    document.getElementById('ce-tags').value='';
    document.getElementById('case-dlg-title').textContent='新建用例';
    populateGroupSelect(activeCaseType()==='voice_ticket_dialogue'?'工单结构化':'默认分组');
    loadCaseTemplateOptions('',function(){renderTemplateExpectedEditors({});});
    renderCaseStageModal(doc||null);
    if(doc){
        document.getElementById('case-dlg-title').textContent='编辑用例';
        document.getElementById('ce-id').value=doc.id;
        document.getElementById('ce-caseId').value=doc.caseId||'';
        document.getElementById('ce-name').value=doc.name||'';
        document.getElementById('ce-uid').value=doc.userId||'';
        document.getElementById('ce-tags').value=doc.tags||'';
        populateGroupSelect(doc.groupName||'默认分组');
        loadCaseTemplateOptions(doc.template_id||doc.templateId||'',function(){renderTemplateExpectedEditors(doc.expected||{});});
        renderCaseStageModal(doc);
    }
    document.getElementById('ol-case').classList.add('open');
}
function autoGenUid(){
    var tierEl=document.getElementById('ce-tier');
    if(!tierEl) return;
    var tier=tierEl.value;
    fetch(BASE+'/api/generate-user-id?tier='+tier).then(r=>r.json()).then(d=>{
        if(d.code==='10000') document.getElementById('ce-uid').value=d.data;
        else toast(d.message||'生成失败','err');
    }).catch(function(){toast('请求异常','err');});
}
function closeCM(){ document.getElementById('ol-case').classList.remove('open'); }
