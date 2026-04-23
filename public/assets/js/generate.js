/* -- Generate page -- */
var _llmPreviewRenderTarget='pg-result';
var _schemaPromptTouched=false;
var _generationPromptTouched=false;

/* Render column schema cards in Step 2 */
var CASE_SCHEMA_COLUMNS=[
    'enable','case_id','name','group_name','tags','user_id','input1','input2','input3',
    'eval_type_1','expected_arg_1','judge_prompt_id_1',
    'eval_type_2','expected_arg_2','judge_prompt_id_2',
    'eval_type_3','expected_arg_3','judge_prompt_id_3'
];
var CASE_SCHEMA_COLUMN_TITLES={
    enable:'启用',
    case_id:'Case ID',
    name:'名称',
    group_name:'分组',
    tags:'标签',
    user_id:'用户',
    input1:'输入 1',
    input2:'输入 2',
    input3:'输入 3',
    eval_type_1:'评测类型 1',
    expected_arg_1:'期望字段 1',
    judge_prompt_id_1:'Judge Prompt 1',
    eval_type_2:'评测类型 2',
    expected_arg_2:'期望字段 2',
    judge_prompt_id_2:'Judge Prompt 2',
    eval_type_3:'评测类型 3',
    expected_arg_3:'期望字段 3',
    judge_prompt_id_3:'Judge Prompt 3'
};
function caseSchemaColumnMeta(key){
    var inputType=/^eval_type_/.test(key)?'select':(/^expected_arg_/.test(key)||key==='input1'||key==='input2'||key==='input3'?'textarea':(key==='enable'?'boolean':'text'));
    var source=/^eval_type_/.test(key)?'fixed':(/^expected_arg_/.test(key)||key==='input1'||key==='name'?'llm':(key==='group_name'||key==='user_id'?'batch':'manual'));
    if(/^judge_prompt_id_/.test(key)) source='fixed';
    return {
        key:key,
        title:CASE_SCHEMA_COLUMN_TITLES[key]||key,
        inputType:inputType,
        source:source,
        optional:['user_id','input2','input3','judge_prompt_id_1','judge_prompt_id_2','judge_prompt_id_3'].indexOf(key)>=0,
        prompt:/^expected_arg_/.test(key)?'填写函数名、字段名、关键文本或语义评测阈值，不要求 JSON。':''
    };
}
function currentCaseSchemaColumns(){
    var schema=_caseGenerationSchema||{};
    var cols=Array.isArray(schema.columnSchema)&&schema.columnSchema.length?schema.columnSchema:null;
    if(cols) return cols.map(function(col){return Object.assign(caseSchemaColumnMeta(col.key),col);});
    return CASE_SCHEMA_COLUMNS.map(caseSchemaColumnMeta);
}
function renderColumnSchemaTable(){
    var el=document.getElementById('pg-column-schema');
    if(!el) return;
    var cols=currentCaseSchemaColumns();
    if(!cols.length){
        el.innerHTML='<div style="font-size:12px;color:var(--c-text2);padding:6px 0">Case Schema 加载中…</div>';
        return;
    }
    var srcLabel={auto:'自动',fixed:'固定',batch:'批次锁定',llm:'LLM',manual:'手填'};
    var typeLabel={text:'文本',textarea:'多行文本',json:'JSON',select:'下拉',tags:'标签',number:'数字',boolean:'布尔'};
    var h='<div class="col-schema-grid">';
    cols.forEach(function(col){
        var sc='src-'+(col.source||'manual');
        h+='<div class="col-schema-card'+(col.optional?' optional':'')+'">'+
            '<div class="col-schema-card-key">'+esc(col.key)+'</div>'+
            '<div class="col-schema-card-title">'+esc(col.title)+'</div>'+
            '<div class="col-schema-card-badges">'+
            '<span class="src-badge '+sc+'">'+esc(srcLabel[col.source]||col.source)+'</span>'+
            '<span class="type-badge">'+esc(typeLabel[col.inputType]||col.inputType)+'</span>'+
            (col.dependsOn?'<span class="type-badge" style="color:var(--c-accent)">→'+esc(col.dependsOn)+'</span>':'')+
            '</div>'+
            (col.prompt?'<div class="col-prompt-tip" title="'+ea(col.prompt)+'">↳ '+esc(col.prompt)+'</div>':'')+
            '</div>';
    });
    h+='</div>';
    el.innerHTML=h;
}

function loadWorkbenchContract(){
    return fetch(BASE+'/api/workbench-contract').then(function(r){return r.json();}).then(function(d){
        if(d.code==='10000'){
            renderGenerateTemplateFields(d.data.generateTemplate&&d.data.generateTemplate.columns);
            renderEvaluatorRules(d.data.evaluatorConfig&&d.data.evaluatorConfig.rules);
        }
        return d;
    });
}
function renderGenerateTemplateFields(columns){
    if(Array.isArray(columns)&&columns.length){
        _caseGenerationSchema=Object.assign({},_caseGenerationSchema||{},{columnSchema:columns});
        renderColumnSchemaTable();
    }
}
function renderEvaluatorRules(rules){
    var el=document.getElementById('eval-rules-tbody');
    if(!el) return;
    el.innerHTML=(rules||[]).map(function(rule){
        return '<tr><td>'+esc(rule.stageKey||'')+'</td><td>'+esc(rule.targetField||'')+'</td><td>'+esc(rule.method||'')+'</td></tr>';
    }).join('');
}

/* Return the list of column keys to show in the preview table, using columnSchema */
function getPreviewColumnsFromSchema(){
    return ['__delete'].concat(currentCaseSchemaColumns().map(function(col){return col.key;}));
}

/* Extract a flat string value from a case object given a column key */
function getCellValueByKey(c,key){
    if(key==='enable') return c.enabled!==false?'true':'false';
    if(key==='case_id') return c.caseId||'';
    if(key==='name') return c.name||'';
    if(key==='user_id') return c.userId||'';
    if(key==='group_name') return c.groupName||'';
    if(key==='tags') return c.tags||((c.payload&&Array.isArray(c.payload.noiseTags))?c.payload.noiseTags.join(','):'');
    if(key==='risk_level'||key==='riskLevel') return c.riskLevel||'medium';
    // Voice ticket payload fields
    if(key==='dialogue_text') return (c.payload&&c.payload.dialogueText)||'';
    if(key==='expected_ticket_json'){
        var et=c.payload&&c.payload.expectedTicket;
        if(!et) return '';
        return typeof et==='string'?et:JSON.stringify(et,null,2);
    }
    if(key==='expected_route') return (c.payload&&c.payload.expectedTicket&&c.payload.expectedTicket.routeQueue)||'';
    if(key==='missing_fields'){
        var mf=(c.payload&&c.payload.expectedTicket&&c.payload.expectedTicket.missingFields);
        return Array.isArray(mf)?mf.join('|'):(mf||'');
    }
    if(key==='noise_tags'){
        var nt=c.payload&&c.payload.noiseTags;
        return Array.isArray(nt)?nt.join('|'):(nt||'');
    }
    if(key==='input1'||key==='input2'||key==='input3'){
        var inputIdx=Number(key.replace('input',''))-1;
        var inputs=caseInputs(c);
        return inputs[inputIdx]||'';
    }
    var evals=key.match(/^evaluations_(\d)$/);
    if(evals){
        var eidx=Number(evals[1])-1;
        var evs=(c.turns&&c.turns[eidx]&&c.turns[eidx].evaluations)||[];
        return evs.length?JSON.stringify(evs,null,2):'';
    }
    var ev=key.match(/^(eval_type|expected_arg|judge_prompt_id)_(\d)$/);
    if(ev){
        var slotIdx=Number(ev[2]);
        var slots=collectCaseEvalSlots(c);
        var slot=slots.find(function(item){return item.index===slotIdx;})||{};
        if(ev[1]==='eval_type') return canonicalEvalType(slot.evalType||c[key]||'');
        if(ev[1]==='expected_arg') return expectedArgPlainText(slot.expectedArg||c[key]||'');
        if(ev[1]==='judge_prompt_id') return slot.judgePromptId||c[key]||'';
    }
    // Legacy turn fields kept only so older preview responses still render.
    var m=key.match(/^(input|expected_tool|expected_args|reply_contains|reply_not_contains|judge_prompt|judge_threshold)_(\d)$/);
    if(m){
        var turnIdx=Number(m[2])-1;
        var t=(c.turns||[])[turnIdx]||{};
        var fmap={input:'userInput',expected_tool:'expectedTool',expected_args:'expectedArgs',reply_contains:'replyContains',reply_not_contains:'replyNotContains',judge_prompt:'judgePrompt',judge_threshold:'judgeThreshold'};
        return previewTextValue(t[fmap[m[1]]]);
    }
    return '';
}

/* Download the current preview cases as a CSV file */
function downloadPreviewCsv(){
    var preview=_llmPreviewCases||[];
    if(!preview.length){toast('无预览内容可下载','err');return;}
    var schema=_caseGenerationSchema||{};
    var csvCols=currentCaseSchemaColumns().map(function(col){return col.key;});
    var rows=[csvCols];
    preview.forEach(function(c){
        rows.push(csvCols.map(function(key){return getCellValueByKey(c,key);}));
    });
    var fname=(schema.projectName||'eval').replace(/\s+/g,'_')+'_generated_cases.csv';
    downloadRowsAsCsv(rows,fname,'已下载 '+preview.length+' 条预览用例');
}
var CSV_TEMPLATE_COLUMNS=CASE_SCHEMA_COLUMNS.slice();
var CSV_TEMPLATE_DESCRIPTIONS=[
    '是否启用(true/false)','用例唯一标识','用例名称','分组名称','标签(逗号分隔)','用户ID或权限账号',
    '第1段输入','第2段输入','第3段输入',
    '评测类型1(structure_match/text_match/llm_judge)','期望字段1','Prompt ID 1',
    '评测类型2(structure_match/text_match/llm_judge)','期望字段2','Prompt ID 2',
    '评测类型3(structure_match/text_match/llm_judge)','期望字段3','Prompt ID 3'
];
function initGeneratePage(){
    var p=document.getElementById('pg-generation-prompt');
    if(!p) return;
    if(!_generationPromptTouched||!p.value) p.value=defaultGenerationPrompt();
    var schemaPrompt=document.getElementById('pg-schema-prompt');
    if(schemaPrompt&&!schemaPrompt.value) schemaPrompt.value=defaultSchemaPrompt();
    document.getElementById('pg-prefix').value=document.getElementById('pg-prefix').value||'llm_demo';
    document.getElementById('pg-turns').value=document.getElementById('pg-turns').value||'1';
    document.getElementById('pg-count').value=document.getElementById('pg-count').value||'8';
    var schema=_caseGenerationSchema||{};
    var cols=schema.columnSchema||[];
    var hasTurns=cols.some(function(c){return c.key==='input1';});
    var hasUserId=cols.some(function(c){return c.key==='user_id';});
    // Show/hide vehicle-specific controls based on template
    var turnsWrap=document.getElementById('pg-turns-wrap');
    if(turnsWrap) turnsWrap.style.display=hasTurns?'':'none';
    var vehicleControls=document.getElementById('pg-vehicle-controls');
    if(vehicleControls) vehicleControls.style.display=(hasTurns||hasUserId)?'':'none';
    var sel=document.getElementById('pg-group-select');
    if(sel){
        var groups=generateProjectGroups();
        var previous=sel.value;
        sel.innerHTML=groups.map(function(g){return '<option value="'+esc(g)+'">'+esc(g)+'</option>';}).join('');
        if(previous&&groups.indexOf(previous)!==-1) sel.value=previous;
        else sel.value=groups[0]||'默认分组';
    }
    renderGenerateToolOptions();
    syncAllowedToolsFromExpected();
    refreshSchemaControls();
    updateGenerateGroupLock();
    onGeneratePageModeChange();
}
function activeGenerateProjectId(){
    var p=activeWorkspaceProject();
    return (p&&p.projectId)||localStorage.getItem(PROJECT_ID_KEY)||'vehicle-agent-eval';
}
function caseBelongsToActiveProject(c){
    var projectId=activeGenerateProjectId();
    if(!projectId||projectId==='all') return true;
    return !c.projectId||c.projectId===projectId;
}
function generateProjectGroups(){
    var projectId=activeGenerateProjectId();
    var isVoice=projectId==='voice-ticket-eval'||activeCaseType()==='voice_ticket_dialogue';
    var groups=[];
    allCases.filter(caseBelongsToActiveProject).forEach(function(c){
        var g=c.groupName||'默认分组';
        if(groups.indexOf(g)===-1) groups.push(g);
    });
    var defaults=isVoice
        ?['车辆故障 / 缺失字段','配送履约 / 路由','客户投诉 / 升级','对话理解 / 纠错','ASR 噪声 / 字段抽取','缺失信息 / 防幻觉','复杂对话 / 多问题','售后回访 / 完结确认']
        :['车控 / 开门','车控 / 权限','运营数据 / 城市日报','运营数据 / 多轮上下文','车控 / 批量动作','知识问答 / 安全策略','App 路由 / 寻车','用户偏好 / 昵称','车辆查询 / 指定车辆'];
    defaults.forEach(function(g){if(groups.indexOf(g)===-1) groups.push(g);});
    return groups.length?groups:['默认分组'];
}
function currentGenerateGroup(){
    var custom=document.getElementById('pg-custom-group');
    var selected=document.getElementById('pg-group-select');
    return (custom&&custom.value.trim())||(selected&&selected.value)||'默认分组';
}
function updateGenerateGroupLock(){
    var el=document.getElementById('pg-locked-group');
    if(el) el.textContent=currentGenerateGroup();
}
function onGenerateGroupChange(){
    var custom=document.getElementById('pg-custom-group');
    if(custom) custom.value='';
    updateGenerateGroupLock();
}
function onGeneratePageModeChange(){
    var mode=document.getElementById('pg-mode').value;
    var wrap=document.getElementById('pg-selected-base-wrap');
    if(wrap) wrap.style.display=mode==='expand'?'block':'none';
    renderSelectedBaseIds();
}
function checkedValues(selector){
    var vals=[];
    document.querySelectorAll(selector+' input[type=checkbox]:checked').forEach(function(cb){vals.push(cb.value);});
    return vals;
}
function syncAllowedToolsFromExpected(){
    var expected=(document.getElementById('pg-expected-tool')||{}).value||'freeChat';
    var fixed=(document.getElementById('pg-tool-strategy')||{}).value!=='llm';
    var checks=document.querySelectorAll('#pg-allowed-tools input[type=checkbox]');
    if(!checks.length)return;
    if(!Array.from(checks).some(function(cb){return cb.checked;})){
        checks.forEach(function(cb){cb.checked=cb.value===expected;});
    }
    if(fixed){
        checks.forEach(function(cb){if(cb.value===expected)cb.checked=true;});
    }
}
function renderGenerateToolOptions(){
    var sel=document.getElementById('pg-expected-tool');
    if(!sel)return;
    var schema=_caseGenerationSchema||{};
    var tools=(schema.allowedTools&&schema.allowedTools.length)?schema.allowedTools:['RAG','freeChat','open_door','return_app_native_router','vehicle_control','vehicle_operation_data_query','vehicle_selective_query'];
    var current=sel.value;
    sel.innerHTML=tools.map(function(t){return '<option value="'+esc(t)+'">'+esc(t)+'</option>';}).join('');
    sel.value=tools.indexOf(current)!==-1?current:(tools[0]||'freeChat');
}
function refreshSchemaControls(){
    renderRequiredFields();
    renderAssertionFields();
    renderGenerateToolOptions();
    renderTemplateDoc();
    renderColumnSchemaTable();
    var schemaPrompt=document.getElementById('pg-schema-prompt');
    if(schemaPrompt&&(!_schemaPromptTouched||!schemaPrompt.value)) schemaPrompt.value=defaultSchemaPrompt();
}
function schemaLabel(value){
    var labels={
        caseId:'caseId',
        name:'name',
        groupName:'groupName',
        dialogueText:'dialogueText',
        expectedTicket:'expectedTicket',
        missingFields:'missingFields',
        routeQueue:'routeQueue',
        noiseTags:'noiseTags',
        riskLevel:'riskLevel',
        allowedTools:'allowedTools',
        turns:'turns',
        expectedTools:'expectedTools',
        expectedArgs:'expected_args',
        replyContains:'reply_contains',
        replyNotContains:'reply_not_contains',
        judgePrompt:'judge_prompt',
        judgeThreshold:'judge_threshold',
        mustExtract:'must_extract',
        mustNotInvent:'must_not_invent',
        mustUseLatestValue:'must_use_latest_value',
        mustIgnoreAgentHypothesis:'ignore_agent_hypothesis'
    };
    return labels[value]||value;
}
function renderRequiredFields(){
    var el=document.getElementById('pg-required-fields');
    if(!el)return;
    var schema=_caseGenerationSchema||{};
    var fields=(schema.requiredFields&&schema.requiredFields.length)?schema.requiredFields:['caseId','name','groupName','allowedTools','turns','expectedTools','riskLevel'];
    el.innerHTML=fields.map(function(f){
        return '<label class="field-option locked"><input type="checkbox" checked disabled>'+esc(schemaLabel(f))+'</label>';
    }).join('');
}
function renderAssertionFields(){
    var el=document.getElementById('pg-assertion-fields');
    if(!el)return;
    var existing=Array.from(el.querySelectorAll('input[type=checkbox]'));
    var selected=existing.filter(function(cb){return cb.checked;}).map(function(cb){return cb.value;});
    var hadExisting=existing.length>0;
    var schema=_caseGenerationSchema||{};
    var fields=(schema.assertionFields&&schema.assertionFields.length)?schema.assertionFields:['expectedArgs','replyContains','replyNotContains','judgePrompt','judgeThreshold'];
    if(hadExisting&&!fields.some(function(f){return selected.indexOf(f)!==-1;})){
        hadExisting=false;
    }
    el.innerHTML=fields.map(function(f){
        var checked=!hadExisting||selected.indexOf(f)!==-1;
        return '<label class="field-option"><input type="checkbox" value="'+esc(f)+'" '+(checked?'checked ':'')+'onchange="refreshSchemaControls()">'+esc(schemaLabel(f))+'</label>';
    }).join('');
}
function renderTemplateDoc(){
    var el=document.getElementById('pg-template-doc');
    if(!el)return;
    var schema=_caseGenerationSchema||{};
    var columns=(schema.importColumns&&schema.importColumns.length)?schema.importColumns:CSV_TEMPLATE_COLUMNS;
    var desc=columns.map(function(c,i){return schema.caseType==='voice_ticket_dialogue'?voiceTemplateDescription(c):CSV_TEMPLATE_DESCRIPTIONS[i]||c;});
    var h='<div class="template-scroll"><table><thead><tr>';
    columns.forEach(function(c){h+='<th>'+esc(c)+'</th>';});
    h+='</tr></thead><tbody><tr>';
    desc.forEach(function(d){h+='<td>'+esc(d)+'</td>';});
    h+='</tr></tbody></table></div>';
    el.innerHTML=h;
}
function voiceTemplateDescription(column){
    var desc={
        enable:'是否启用(true/false)',
        case_id:'用例唯一标识',
        name:'用例名称',
        group_name:'分组名称',
        dialogue_text:'ASR 后的一整段多轮对话文本',
        expected_ticket_json:'期望工单 JSON',
        expected_route:'期望路由队列',
        missing_fields:'缺失字段(|分隔)',
        noise_tags:'ASR 噪声/干扰标签(|分隔)',
        risk_level:'风险等级'
    };
    return desc[column]||column;
}
function buildGeneratePagePayload(){
    var mode=document.getElementById('pg-mode').value;
    var count=Math.max(1,Math.min(50,parseInt(document.getElementById('pg-count').value,10)||8));
    var turnCount=Math.max(1,Math.min(3,parseInt(document.getElementById('pg-turns').value,10)||1));
    var boundaries=['权限边界','弱网','多轮引用'];
    var baseCaseIds=[];
    if(mode==='expand'){
        baseCaseIds=selIds();
    }
    var promptText=document.getElementById('pg-generation-prompt').value.trim()||defaultGenerationPrompt();
    var schemaPromptEl=document.getElementById('pg-schema-prompt');
    var schemaPrompt=(schemaPromptEl&&schemaPromptEl.value.trim())||defaultSchemaPrompt();
    var groupName=currentGenerateGroup();
    var expectedTool=document.getElementById('pg-expected-tool').value||'freeChat';
    var allowedTools=[expectedTool];
    var assertions=checkedValues('#pg-assertion-fields');
    var schema=_caseGenerationSchema||{};
    var stageDefs=activeStageDefinitions();
    var evalDimensions=(schema.evalDimensions&&schema.evalDimensions.length)
        ? schema.evalDimensions
        : stageDefs.map(function(stage){return stage.key;});
    updateGenerateGroupLock();
    return {
        mode:mode,
        module:activeCaseType()==='voice_ticket_dialogue'?'voice_ticket':'vehicle_query',
        count:count,
        objective:promptText.split('\n').map(function(v){return v.trim();}).filter(Boolean)[0]||'按业务覆盖目标生成用例',
        boundaryTags:boundaries,
        turnCount:turnCount,
        baseCaseIds:baseCaseIds,
        groupName:groupName,
        businessObjective:promptText,
        schemaPrompt:schemaPrompt,
        selectedAssertionFields:assertions,
        evalDimensions:evalDimensions,
        defaultRiskLevel:'medium',
        userTier:(document.getElementById('pg-user-strategy')||{}).value||'FULL',
        expectedToolStrategy:'fixed',
        expectedTool:expectedTool,
        allowedTools:allowedTools,
        caseIdPrefix:document.getElementById('pg-prefix').value.trim(),
        actor:'llm-generator-ui'
    };
}
function previewGeneratePage(){
    var payload=buildGeneratePagePayload();
    _llmPreviewRenderTarget='pg-result';
    fetch(BASE+'/api/case-service/generate-preview',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)})
        .then(function(r){return r.json();})
        .then(function(d){
            if(d.code!=='10000'){showLlmResult('预览失败: '+(d.message||''),false);return;}
            var data=d.data||{};
            _llmPreviewCases=data.preview||[];
            _llmPreviewWarning=data.warning||'';
            _llmPreviewVisibleLimit=Math.min(10,Math.max(1,_llmPreviewCases.length));
            if(!_llmPreviewCases.length){showLlmResult('未生成可预览内容，请调整条件后重试。',false,false);return;}
            showLlmResult(renderLlmPreview(),true,true);
        })
        .catch(function(){showLlmResult('预览请求失败',false);});
}
function submitGeneratePage(){
    _llmPreviewRenderTarget='pg-result';
    var request;
    if(_llmPreviewCases.length){
        request=fetch(BASE+'/api/case-service/upload-preview',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({cases:_llmPreviewCases})});
    }else{
        var payload=buildGeneratePagePayload();
        request=fetch(BASE+'/api/case-service/generate-upload',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});
    }
    request.then(function(r){return r.json();}).then(function(d){
        if(d.code!=='10000'){showLlmResult('生成失败: '+(d.message||''),false);return;}
        var data=d.data||{};
        var msg='已自动解析并上传 '+(data.inserted||0)+' 条到用例库（默认非回归）';
        if(data.warning) msg+='\n提示: '+data.warning;
        showLlmResult(msg,true);
        toast('生成完成: '+(data.inserted||0)+' 条已加入用例库','ok');
        _llmPreviewCases=[];
        _llmPreviewWarning='';
        loadCases();
    }).catch(function(){showLlmResult('生成请求失败',false);});
}

var _llmPreviewCases=[];
var _llmPreviewVisibleLimit=10;
var _llmPreviewWarning='';
function renderSchemaNote(targetId){
    var el=document.getElementById(targetId);
    if(!el)return;
    if(!_caseGenerationSchema){
        el.textContent='Schema 加载中...';
        return;
    }
    var required=_caseGenerationSchema.requiredFields||[];
    var turn=_caseGenerationSchema.turnFields||[];
    var assertions=_caseGenerationSchema.assertionFields||[];
    var imports=_caseGenerationSchema.importColumns||[];
    el.innerHTML =
        '<strong>输出字段结构：</strong>字段结构全项目统一，业务覆盖目标单独填写。'+
        '<div class="schema-mini-title">必填字段</div>'+
        '<div class="schema-chip-row">'+required.map(function(v){return '<span class="schema-chip">'+esc(v)+'</span>';}).join('')+'</div>'+
        '<div class="schema-mini-title">轮次字段</div>'+
        '<div class="schema-chip-row">'+turn.map(function(v){return '<span class="schema-chip">'+esc(v)+'</span>';}).join('')+'</div>'+
        '<div class="schema-mini-title">断言字段</div>'+
        '<div class="schema-chip-row">'+assertions.map(function(v){return '<span class="schema-chip">'+esc(v)+'</span>';}).join('')+'</div>'+
        '<div class="schema-mini-title">导入列</div>'+
        '<div class="schema-chip-row">'+imports.map(function(v){return '<span class="schema-chip">'+esc(v)+'</span>';}).join('')+'</div>';
    var schemaPrompt=document.getElementById('pg-schema-prompt');
    if(schemaPrompt&&(!_schemaPromptTouched||!schemaPrompt.value)){
        schemaPrompt.value=defaultSchemaPrompt();
    }
    refreshSchemaControls();
}
function loadCaseGenerationSchema(){
    fetch(BASE+'/api/case-service/schema').then(function(r){return r.json();}).then(function(d){
        if(d.code==='10000'){
            _caseGenerationSchema=d.data;
            renderSchemaNote('pg-schema-note');
            refreshSchemaControls();
            var generationPrompt=document.getElementById('pg-generation-prompt');
            if(generationPrompt&&(!_generationPromptTouched||!generationPrompt.value)) generationPrompt.value=defaultGenerationPrompt();
            var schemaPrompt=document.getElementById('pg-schema-prompt');
            if(schemaPrompt&&(!_schemaPromptTouched||!schemaPrompt.value)) schemaPrompt.value=defaultSchemaPrompt();
            initGeneratePage();
            renderCasesTableHeader();
            if(allCases.length) renderCases(filteredCases.length?filteredCases:allCases);
        }
    }).catch(function(){
        var el=document.getElementById('pg-schema-note');
        if(el)el.textContent='Schema 加载失败，仍会使用平台默认字段约束。';
    });
}
function defaultSchemaPrompt(){
    var schema=_caseGenerationSchema||{};
    var imports=currentCaseSchemaColumns().map(function(col){return col.key;});
    var stages=activeStageDefinitions().map(function(stage){return (stage.label||stage.key)+'('+stage.key+')';});
    if(activeCaseType()==='voice_ticket_dialogue'||schema.caseType==='voice_ticket_dialogue'){
        return [
            '输出字段结构：使用语音工单项目专属 CSV Schema。',
            'Stage 链路：'+stages.join(' → '),
            '输入字段：dialogue_text 写完整 ASR 对话文本。',
            '评测字段：expected_ticket_json 写期望工单 JSON；expected_route 写期望队列；missing_fields 写应识别的缺失字段；noise_tags 写 ASR 噪声/改口/多轮补全标签。',
            '导入列：'+imports.join(', '),
            '评测规则：评测工单语义结构、字段准确性、缺失字段、路由队列和禁止编造；不要求工具调用。'
        ].join('\n');
    }
    return [
        '输出字段结构：使用 Agent 项目专属 CSV Schema。',
        'Stage 链路：'+stages.join(' → '),
        '输入字段：input1/input2/input3 分别对应最多三段用户输入。',
        '中间链路评测字段：evaluations_1/evaluations_2/evaluations_3 是 JSON 数组，每项包含 stageKey、evalType、expected。',
        '兼容字段：expected_tool_N、expected_args_N、reply_contains_N、reply_not_contains_N、judge_prompt_N、judge_threshold_N 可由 evaluations_N 推导，也可直接填写。',
        '导入列：'+imports.join(', '),
        '断言规则：structure_match 用于工具/参数结构，text_match 用于回复须含/禁含，llm_judge 用于语义质量；每条 case 只保存勾选的 Stage。'
    ].join('\n');
}
function resetSchemaPrompt(){
    var el=document.getElementById('pg-schema-prompt');
    if(!el)return;
    el.value=defaultSchemaPrompt();
    _schemaPromptTouched=false;
}
function defaultGenerationPrompt(){
    if(activeCaseType()==='voice_ticket_dialogue'){
        return [
            'ASR 对话工单结构化语义测评覆盖目标：',
            '输入是一整段坐席/用户 ASR 多轮对话文本，input1 承载完整对话。',
            '覆盖多轮补全、用户改口、坐席假设干扰、噪声词、缺失联系人/地点/车辆编号等真实对话问题。',
            '评测 AI 输出的工单语义结构、字段准确性、缺失字段、路由队列和禁止编造。',
            '每条 case 要写清 expected_arg_1 的工单字段、expected_arg_2 的关键文本和 judge_prompt_id_3。'
        ].join('\n');
    }
    return [
        '车辆控制专项覆盖目标：',
        '成功路径覆盖远程开门/关门、鸣笛闪灯、空调开关与温度设置、车辆定位或寻车入口跳转，用户表达要像真实车主或运维人员。',
        '权限与状态边界覆盖无权限车辆、非绑定用户、车辆离线、车门已开/已锁、车辆行驶中、低电量或信号弱导致无法执行。',
        '多轮用例要体现上下文引用，例如“第一辆车”“刚才那辆车”“这台车”，并验证系统能继承上一轮车辆、动作或园区上下文。',
        '每条用例写清 expected_arg_1 的函数或结构字段、expected_arg_2 的回复关键文本和 expected_arg_3 的语义阈值。',
        '不要只改同义句；请覆盖不同业务意图、不同失败原因、不同车辆数据条件。'
    ].join('\n');
}
function showLlmResult(text,ok,html){
    var box=document.getElementById(_llmPreviewRenderTarget||'pg-result');
    if(!box) box=document.getElementById('pg-result');
    box.style.display='block';
    if(html){
        box.innerHTML=text;
        box.style.whiteSpace='normal';
    }else{
        box.textContent=text;
        box.style.whiteSpace='pre-line';
    }
    box.style.borderColor=ok?'#86efac':'#fca5a5';
    box.style.background=ok?'#f0fdf4':'#fef2f2';
    box.style.color=ok?'#166534':'#991b1b';
}
function setLlmPreviewVisibleLimit(v){
    var total=_llmPreviewCases.length;
    if(!total)return;
    _llmPreviewVisibleLimit=Math.max(1,Math.min(total,parseInt(v,10)||10));
    showLlmResult(renderLlmPreview(),true,true);
}
function removeLlmPreviewItem(idx){
    if(idx<0||idx>=_llmPreviewCases.length)return;
    _llmPreviewCases.splice(idx,1);
    if(!_llmPreviewCases.length){
        showLlmResult('当前预览已清空，请重新点击“生成预览”。',false,false);
        return;
    }
    if(_llmPreviewVisibleLimit>_llmPreviewCases.length){
        _llmPreviewVisibleLimit=_llmPreviewCases.length;
    }
    showLlmResult(renderLlmPreview(),true,true);
}
function renderLlmPreview(){
    var previewColumns=getPreviewColumnsFromSchema();
    var colDefs={};
    currentCaseSchemaColumns().forEach(function(c){colDefs[c.key]=c;});

    function cellClass(col){
        var def=colDefs[col]||{};
        var t=def.inputType||'';
        if(t==='boolean'||t==='number'||col==='enable'||col==='user_id'||col.indexOf('eval_type_')===0) return 'preview-cell short';
        if(col==='case_id'||col==='group_name'||col==='tags'||col.indexOf('judge_prompt_id_')===0) return 'preview-cell medium';
        return 'preview-cell long';
    }
    function renderPreviewCell(c,rowIdx,col){
        if(col==='__delete'){
            return '<button class="btn btn-ghost btn-sm" style="color:var(--c-red);padding:0 6px" onclick="removeLlmPreviewItem('+rowIdx+')">×</button>';
        }
        var def=colDefs[col]||{};
        var inputType=def.inputType||'text';
        var value=getCellValueByKey(c,col);
        // boolean → true/false select
        if(inputType==='boolean'||col==='enable'){
            return '<select class="'+cellClass(col)+'" onchange="setPreviewCsvField('+rowIdx+',\''+col+'\',this.value)">'+
                '<option value="true"'+(value==='true'?' selected':'')+'>true</option>'+
                '<option value="false"'+(value==='false'?' selected':'')+'>false</option></select>';
        }
        // risk_level select
        if(col==='risk_level'||col==='riskLevel'){
            var risk=value||'medium';
            return '<select class="'+cellClass(col)+'" onchange="setPreviewCsvField('+rowIdx+',\''+col+'\',this.value)">'+
                '<option value="low"'+(risk==='low'?' selected':'')+'>low</option>'+
                '<option value="medium"'+(risk==='medium'?' selected':'')+'>medium</option>'+
                '<option value="high"'+(risk==='high'?' selected':'')+'>high</option></select>';
        }
        // group_name → disabled (locked at batch level)
        if(col==='group_name'){
            return '<input class="'+cellClass(col)+'" value="'+ea(value||'默认分组')+'" disabled>';
        }
        if(col.indexOf('eval_type_')===0){
            return '<select class="'+cellClass(col)+' mono" onchange="setPreviewCsvField('+rowIdx+',\''+col+'\',this.value)">'+
                '<option value="structure_match"'+(value==='structure_match'?' selected':'')+'>structure_match</option>'+
                '<option value="text_match"'+(value==='text_match'?' selected':'')+'>text_match</option>'+
                '<option value="llm_judge"'+(value==='llm_judge'?' selected':'')+'>llm_judge</option>'+
                '</select>';
        }
        // multi-line / JSON / tags → textarea
        if(inputType==='textarea'||inputType==='json'||inputType==='tags'||
           col.indexOf('input')===0||col.indexOf('expected_arg_')===0||col.indexOf('expected_args_')===0||
           col.indexOf('reply_contains_')===0||col.indexOf('reply_not_contains_')===0||
           col.indexOf('judge_prompt_')===0||col==='dialogue_text'||
           col==='expected_ticket_json'||col==='missing_fields'||col==='noise_tags'){
            var mono=inputType==='json'||col.indexOf('expected_arg_')===0||col.indexOf('expected_args_')===0||col==='expected_ticket_json';
            return '<textarea class="'+cellClass(col)+(mono?' mono':'')+'" oninput="setPreviewCsvField('+rowIdx+',\''+col+'\',this.value)">'+esc(value)+'</textarea>';
        }
        // default → text input
        var isMono=col==='case_id'||col==='user_id'||col.indexOf('judge_prompt_id_')===0||col.indexOf('judge_threshold_')===0;
        return '<input class="'+cellClass(col)+(isMono?' mono':'')+'" value="'+ea(value)+'" oninput="setPreviewCsvField('+rowIdx+',\''+col+'\',this.value)">';
    }

    var preview=_llmPreviewCases||[];
    var total=preview.length;
    var visiblePreview=preview.slice(0,Math.min(_llmPreviewVisibleLimit,total));
    // Show/hide download button
    var actionsEl=document.getElementById('pg-preview-actions');
    if(actionsEl) actionsEl.style.display=total?'flex':'none';
    var h='<div style="display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:10px">'+
        '<div><b>预览入库字段</b></div>'+
        '<span class="tag tag-done">显示 '+visiblePreview.length+' / '+total+' 条候选</span>'+
        '</div>';
    if(_llmPreviewWarning){
        h+='<div style="font-size:12px;color:var(--c-amber);margin-bottom:8px">'+esc(_llmPreviewWarning)+'</div>';
    }
    var tableMaxHeight=_llmPreviewRenderTarget==='pg-result'?'420px':'360px';
    h+='<div class="gen-preview-scroll" style="max-height:'+tableMaxHeight+';max-width:100%">'+
        '<table style="font-size:12px"><thead><tr>';
    previewColumns.forEach(function(col){
        var def=colDefs[col]||{};
        var srcClass=col==='__delete'?'':' class="src-badge src-'+(def.source||'manual')+'" style="display:inline-block;margin-bottom:2px"';
        var label=col==='__delete'?'删除':(def.title||col);
        h+='<th><div'+srcClass+(col==='__delete'?'':'')+'>'+esc(label)+'</div>'+
            (col!=='__delete'?'<div style="font-size:10px;color:var(--c-text3);font-weight:400;font-family:monospace">'+esc(col)+'</div>':'')+
            '</th>';
    });
    h+='</tr></thead><tbody>';
    visiblePreview.forEach(function(c,idx){
        h+='<tr>';
        previewColumns.forEach(function(col){
            h+='<td'+(col==='__delete'?' style="text-align:center"':'')+'>'+renderPreviewCell(c,idx,col)+'</td>';
        });
        h+='</tr>';
    });
    h+='</tbody></table></div>';
    if(preview[0]&&preview[0].generationPrompt){
        h+='<details style="margin-top:10px;border:1px solid var(--c-border);border-radius:8px;background:#fff;padding:8px 10px;color:var(--c-text)">'+
            '<summary style="cursor:pointer;font-size:12px;font-weight:700">生成依据 Prompt</summary>'+
            '<pre style="white-space:pre-wrap;word-break:break-word;margin-top:8px;font-size:11px;color:var(--c-text2);font-family:SFMono-Regular,Menlo,monospace;max-height:180px;overflow:auto">'+esc(preview[0].generationPrompt)+'</pre>'+
            '</details>';
    }
    return h;
}
function previewTextValue(value){
    if(Array.isArray(value)) return value.join(';');
    if(value===undefined||value===null) return '';
    if(typeof value==='object') return JSON.stringify(value);
    return String(value);
}
function setPreviewCaseField(idx,key,value){
    if(!_llmPreviewCases[idx])return;
    if(key==='enabled') _llmPreviewCases[idx][key]=value==='true';
    else _llmPreviewCases[idx][key]=value;
}
function setPreviewTurnField(caseIdx,turnIdx,key,value){
    var c=_llmPreviewCases[caseIdx];
    if(!c)return;
    if(!Array.isArray(c.turns)) c.turns=[];
    if(!c.turns[turnIdx]) c.turns[turnIdx]={turnIndex:turnIdx+1,userInput:'',expectedTool:''};
    if(key==='replyContains'||key==='replyNotContains'){
        c.turns[turnIdx][key]=String(value||'').split(/[;；|]/).map(function(v){return v.trim();}).filter(Boolean);
    }else if(key==='judgeThreshold'){
        c.turns[turnIdx][key]=value;
    }else{
        c.turns[turnIdx][key]=value;
    }
    c.expectedTools=(c.turns||[]).map(function(t){return t.expectedTool;}).filter(Boolean);
}
function setPreviewCsvField(caseIdx,col,value){
    var c=_llmPreviewCases[caseIdx];
    if(!c)return;
    if(col==='enable'){ c.enabled=value==='true'; return; }
    if(col==='case_id'){ c.caseId=value; return; }
    if(col==='name'){ c.name=value; return; }
    if(col==='user_id'){ c.userId=value; return; }
    if(col==='group_name'){ c.groupName=value; return; }
    if(col==='tags'){ c.tags=value; return; }
    if(col==='riskLevel'||col==='risk_level'){ c.riskLevel=value; return; }
    if(col==='dialogue_text'){
        if(!c.payload)c.payload={};
        c.payload.dialogueText=value;
        c.input1=value;
        return;
    }
    if(col==='expected_ticket_json'){
        if(!c.payload)c.payload={};
        try{c.payload.expectedTicket=JSON.parse(value||'{}');}
        catch(e){c.payload.expectedTicket=value;}
        return;
    }
    if(col==='expected_route'){
        if(!c.payload)c.payload={};
        if(!c.payload.expectedTicket||typeof c.payload.expectedTicket!=='object')c.payload.expectedTicket={};
        c.payload.expectedTicket.routeQueue=value;
        return;
    }
    if(col==='missing_fields'){
        if(!c.payload)c.payload={};
        if(!c.payload.expectedTicket||typeof c.payload.expectedTicket!=='object')c.payload.expectedTicket={};
        c.payload.expectedTicket.missingFields=String(value||'').split(/[|,，\n]/).map(function(v){return v.trim();}).filter(Boolean);
        return;
    }
    if(col==='noise_tags'){
        if(!c.payload)c.payload={};
        c.payload.noiseTags=String(value||'').split(/[|,，\n]/).map(function(v){return v.trim();}).filter(Boolean);
        c.tags=c.payload.noiseTags.join(',');
        return;
    }
    if(col==='input1'||col==='input2'||col==='input3'){
        setPreviewTurnField(caseIdx,Number(col.replace('input',''))-1,'userInput',value);
        c[col]=value;
        return;
    }
    var evals=col.match(/^evaluations_(\d)$/);
    if(evals){
        var evTurnIdx=Number(evals[1])-1;
        if(!Array.isArray(c.turns)) c.turns=[];
        if(!c.turns[evTurnIdx]) c.turns[evTurnIdx]={turnIndex:evTurnIdx+1,userInput:'',expectedTool:''};
        try{c.turns[evTurnIdx].evaluations=JSON.parse(value||'[]');}
        catch(e){c.turns[evTurnIdx].evaluations=[];}
        return;
    }
    var ev=col.match(/^(eval_type|expected_arg|judge_prompt_id)_(\d)$/);
    if(ev){
        c[col]=value;
        return;
    }
    var m=col.match(/^(input|expected_tool|expected_args|reply_contains|reply_not_contains|judge_prompt|judge_threshold)_(\d)$/);
    if(!m)return;
    var turnIdx=Number(m[2])-1;
    var map={input:'userInput',expected_tool:'expectedTool',expected_args:'expectedArgs',reply_contains:'replyContains',reply_not_contains:'replyNotContains',judge_prompt:'judgePrompt',judge_threshold:'judgeThreshold'};
    setPreviewTurnField(caseIdx,turnIdx,map[m[1]],value);
}
function previewToolOptions(selected){
    var opts='';
    _allToolNames.concat(['RAG','freeChat','open_door','return_app_native_router','vehicle_control','vehicle_operation_data_query','vehicle_selective_query'])
        .filter(function(v,i,a){return v&&a.indexOf(v)===i;})
        .forEach(function(t){opts+='<option value="'+ea(t)+'"'+(t===selected?' selected':'')+'>'+esc(t)+'</option>';});
    return opts;
}
function renderPreviewCard(c,idx,assertions){
    var turns=c.turns||[];
    var h='<div class="preview-card">'+
        '<div class="preview-card-head">'+
        '<div><label class="preview-label">case_id</label><input class="preview-input mono" value="'+ea(c.caseId||'')+'" oninput="setPreviewCaseField('+idx+',\'caseId\',this.value)"></div>'+
        '<div><label class="preview-label">name</label><input class="preview-input" value="'+ea(c.name||'')+'" oninput="setPreviewCaseField('+idx+',\'name\',this.value)"></div>'+
        '<div><label class="preview-label">user_id</label><input class="preview-input mono" value="'+ea(c.userId||'')+'" oninput="setPreviewCaseField('+idx+',\'userId\',this.value)"></div>'+
        '<div><label class="preview-label">riskLevel</label><select class="preview-input" onchange="setPreviewCaseField('+idx+',\'riskLevel\',this.value)">'+
        '<option value="low"'+(c.riskLevel==='low'?' selected':'')+'>low</option><option value="medium"'+((c.riskLevel||'medium')==='medium'?' selected':'')+'>medium</option><option value="high"'+(c.riskLevel==='high'?' selected':'')+'>high</option></select></div>'+
        '<div><label class="preview-label">enable</label><select class="preview-input" onchange="setPreviewCaseField('+idx+',\'enabled\',this.value)"><option value="true"'+(c.enabled!==false?' selected':'')+'>true</option><option value="false"'+(c.enabled===false?' selected':'')+'>false</option></select></div>'+
        '<button class="btn btn-ghost btn-sm" style="color:var(--c-red);align-self:center" onclick="removeLlmPreviewItem('+idx+')">删除</button>'+
        '</div>';
    turns.forEach(function(t,tidx){
        h+='<div class="preview-turn">'+
            '<div style="font-size:12px;font-weight:800;color:var(--c-accent);margin-bottom:7px">第 '+(tidx+1)+' 轮</div>'+
            '<div class="preview-turn-grid">'+
            '<div><label class="preview-label">input'+(tidx+1)+'</label><textarea class="preview-input" oninput="setPreviewTurnField('+idx+','+tidx+',\'userInput\',this.value)">'+esc(t.userInput||'')+'</textarea></div>'+
            '<div><label class="preview-label">expected_tool_'+(tidx+1)+'</label><select class="preview-input mono" onchange="setPreviewTurnField('+idx+','+tidx+',\'expectedTool\',this.value)">'+previewToolOptions(t.expectedTool||'')+'</select></div>'+
            '</div>';
        if(assertions.length){
            h+='<div class="preview-assert-grid">';
            if(assertions.indexOf('expectedArgs')>=0) h+='<div><label class="preview-label">expected_args_'+(tidx+1)+'</label><textarea class="preview-input mono" oninput="setPreviewTurnField('+idx+','+tidx+',\'expectedArgs\',this.value)">'+esc(previewTextValue(t.expectedArgs))+'</textarea></div>';
            if(assertions.indexOf('replyContains')>=0) h+='<div><label class="preview-label">reply_contains_'+(tidx+1)+'</label><textarea class="preview-input" oninput="setPreviewTurnField('+idx+','+tidx+',\'replyContains\',this.value)">'+esc(previewTextValue(t.replyContains))+'</textarea></div>';
            if(assertions.indexOf('replyNotContains')>=0) h+='<div><label class="preview-label">reply_not_contains_'+(tidx+1)+'</label><textarea class="preview-input" oninput="setPreviewTurnField('+idx+','+tidx+',\'replyNotContains\',this.value)">'+esc(previewTextValue(t.replyNotContains))+'</textarea></div>';
            if(assertions.indexOf('judgePrompt')>=0) h+='<div><label class="preview-label">judge_prompt_'+(tidx+1)+'</label><textarea class="preview-input" oninput="setPreviewTurnField('+idx+','+tidx+',\'judgePrompt\',this.value)">'+esc(t.judgePrompt||'')+'</textarea></div>';
            if(assertions.indexOf('judgeThreshold')>=0) h+='<div><label class="preview-label">judge_threshold_'+(tidx+1)+'</label><input class="preview-input mono" value="'+ea(t.judgeThreshold||'')+'" oninput="setPreviewTurnField('+idx+','+tidx+',\'judgeThreshold\',this.value)"></div>';
            h+='</div>';
        }
        h+='</div>';
    });
    return h+'</div>';
}
function renderCsvPreviewTable(preview){
    function val(c,col){
        if(col==='enable') return c.enabled!==false?'true':'false';
        if(col==='case_id') return c.caseId||'';
        if(col==='name') return c.name||'';
        if(col==='user_id') return c.userId||'';
        if(col==='group_name') return c.groupName||'';
        var m=col.match(/^(input|expected_tool|expected_args|reply_contains|reply_not_contains|judge_prompt|judge_threshold)_(\d)$/);
        if(!m)return '';
        var t=(c.turns||[])[Number(m[2])-1]||{};
        var map={input:'userInput',expected_tool:'expectedTool',expected_args:'expectedArgs',reply_contains:'replyContains',reply_not_contains:'replyNotContains',judge_prompt:'judgePrompt',judge_threshold:'judgeThreshold'};
        return previewTextValue(t[map[m[1]]]);
    }
    var h='<div class="template-scroll" style="margin-top:8px"><table><thead><tr>';
    CSV_TEMPLATE_COLUMNS.forEach(function(c){h+='<th>'+esc(c)+'</th>';});
    h+='</tr></thead><tbody>';
    preview.forEach(function(c){
        h+='<tr>';
        CSV_TEMPLATE_COLUMNS.forEach(function(col){h+='<td>'+esc(val(c,col))+'</td>';});
        h+='</tr>';
    });
    return h+'</tbody></table></div>';
}
function renderLlmPreviewCardDraft(){
    var preview=_llmPreviewCases||[];
    var total=preview.length;
    var visiblePreview=preview.slice(0,Math.min(_llmPreviewVisibleLimit,total));
    var assertions=checkedValues('#pg-assertion-fields');
    var h='<div style="display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:10px">'+
        '<div><b>备用编辑视图</b></div>'+
        '<span class="tag tag-done">显示 '+visiblePreview.length+' / '+total+' 条候选</span>'+
        '</div>';
    if(_llmPreviewWarning) h+='<div style="font-size:12px;color:var(--c-amber);margin-bottom:8px">'+esc(_llmPreviewWarning)+'</div>';
    visiblePreview.forEach(function(c,idx){h+=renderPreviewCard(c,idx,assertions);});
    h+='<details style="margin-top:10px;border:1px solid var(--c-border);border-radius:8px;background:#fff;padding:8px 10px;color:var(--c-text)">'+
        '<summary style="cursor:pointer;font-size:12px;font-weight:700">CSV 列视图</summary>'+
        renderCsvPreviewTable(visiblePreview)+
        '</details>';
    if(preview[0]&&preview[0].generationPrompt){
        h+='<details style="margin-top:10px;border:1px solid var(--c-border);border-radius:8px;background:#fff;padding:8px 10px;color:var(--c-text)">'+
            '<summary style="cursor:pointer;font-size:12px;font-weight:700">生成依据 Prompt</summary>'+
            '<pre style="white-space:pre-wrap;word-break:break-word;margin-top:8px;font-size:11px;color:var(--c-text2);font-family:SFMono-Regular,Menlo,monospace;max-height:180px;overflow:auto">'+esc(preview[0].generationPrompt)+'</pre>'+
            '</details>';
    }
    return h;
}
function buildToolOptions(selected){
    var opts='<option value="">-- 选择工具 --</option>';
    var schema=_caseGenerationSchema||{};
    var tools=(_allToolNames&&_allToolNames.length)?_allToolNames:(schema.allowedTools||['vehicle_selective_query','vehicle_control','open_door','return_app_native_router','vehicle_operation_data_query','freeChat','RAG']);
    tools.forEach(function(t){opts+='<option value="'+ea(t)+'"'+(t===selected?' selected':'')+'>'+esc(t)+'</option>';});
    return opts;
}
function evalTypeOptions(selected){
    return CASE_EVAL_TYPES.map(function(item){
        return '<option value="'+ea(item.value)+'"'+(item.value===selected?' selected':'')+'>'+esc(item.label+(item.value?' ('+item.value+')':''))+'</option>';
    }).join('');
}
function renderEvalEditors(slots){
    var ct=document.getElementById('eval-ct');
    if(!ct) return;
    var byIndex={};
    (slots||[]).forEach(function(slot){byIndex[slot.index]=slot;});
    var html='';
    for(var i=1;i<=3;i++){
        var slot=byIndex[i]||{};
        html+='<div class="eval-card" data-eval-index="'+i+'">'+
            '<div class="eval-card-head"><span class="eval-card-num">'+i+'</span><strong>评测点 '+i+'</strong></div>'+
            '<div class="eval-grid">'+
            '<div class="fg"><label class="fl">eval_type_'+i+'</label><select class="fi ev-type" data-index="'+i+'">'+evalTypeOptions(slot.evalType||'')+'</select></div>'+
            '<div class="fg"><label class="fl">expected_arg_'+i+'</label><textarea class="fi eval-arg-ta ev-arg" data-index="'+i+'" rows="4" placeholder="填写期望字段、函数名、关键文本或评测说明">'+esc(slot.expectedArg||'')+'</textarea></div>'+
            '<div class="fg"><label class="fl">judge_prompt_id_'+i+'</label><input class="fi ev-judge" data-index="'+i+'" value="'+ea(slot.judgePromptId||'')+'" placeholder="需要语义评测时填写"></div>'+
            '</div>'+
            '</div>';
    }
    ct.innerHTML=html;
}
function renderCaseStageModal(doc){
    var isVoice=activeCaseType()==='voice_ticket_dialogue';
    var chain=document.getElementById('ce-stage-chain');
    var userWrap=document.getElementById('ce-user-wrap');
    var title=document.getElementById('ce-fields-title');
    if(userWrap) userWrap.style.display=isVoice?'none':'';
    if(title) title.style.display='none';
    if(chain){
        chain.innerHTML='';
        chain.style.display='none';
    }
    var box=document.getElementById('eval-ct')&&document.getElementById('eval-ct').closest('.case-schema-box');
    if(box){
        box.style.border='0';
        box.style.background='transparent';
        box.style.padding='0';
        box.style.marginTop='12px';
    }
    if(isVoice) renderVoiceCaseStageFields(doc||{});
    else renderAgentCaseStageFields(doc||{});
}
function renderTemplateExpectedEditors(expected){
    var box=document.getElementById('ce-template-expected-fields');
    if(!box) return;
    var t=selectedCaseTemplate();
    var fields=templateExpectedFields(t);
    if(!t){box.innerHTML='<div class="empty">选择评测模板后，这里会出现该模板需要填写的期望内容。</div>';return;}
    if(!fields.length){box.innerHTML='<div class="empty">这个模板没有需要 Case 填写的期望内容。</div>';return;}
    expected=expected||{};
    box.innerHTML=fields.map(function(f){
        var val=expected[f.key];
        if(Array.isArray(val)) val=val.join('\n');
        if(val&&typeof val==='object') val=JSON.stringify(val,null,2);
        val=val==null?'':String(val);
        if(f.type==='input') return '<div class="fg"><label class="fl">'+esc(f.label)+'</label><input class="fi ce-expected-field" data-key="'+ea(f.key)+'" value="'+ea(val)+'" placeholder="'+ea(f.placeholder||'')+'"></div>';
        return '<div class="fg"><label class="fl">'+esc(f.label)+'</label><textarea class="fi ce-expected-field" data-key="'+ea(f.key)+'" rows="3" placeholder="'+ea(f.placeholder||'')+'">'+esc(val)+'</textarea></div>';
    }).join('');
}
function onCaseTemplateChanged(){
    renderTemplateExpectedEditors({});
}
function valueOrEmpty(v){
    if(v===undefined||v===null) return '';
    if(typeof v==='object') return JSON.stringify(v,null,2);
    return String(v);
}
function renderAgentCaseStageFields(doc){
    var ct=document.getElementById('eval-ct');
    var input=doc.input1||((doc.turns||[])[0]&&doc.turns[0].userInput)||'';
    ct.innerHTML='<div class="turns-box" style="margin-top:0"><h4>样本输入</h4>'+
        '<div class="fg"><label class="fl">用户输入</label><textarea class="fi" id="ce-simple-input" rows="4" placeholder="例如：帮我打开左前车门">'+esc(input)+'</textarea></div>'+
        '</div>';
}
function stageDefaultEvalType(stageKey){
    var stage=activeStageDefinitions().find(function(item){return item.key===stageKey;})||{};
    return (stage.evalTypes&&stage.evalTypes[0])||'structure_match';
}
function evalByStage(evals,stageKey){
    return (evals||[]).find(function(ev){return ev&&ev.stageKey===stageKey;})||null;
}
function addAgentTurnCard(turn){
    var ct=document.getElementById('agent-turns-ct');
    if(!ct)return;
    var idx=ct.querySelectorAll('.agent-turn-card').length+1;
    var d=document.createElement('div');
    d.className='eval-card agent-turn-card';
    d.innerHTML='<div class="eval-card-head"><span class="eval-card-num">'+idx+'</span><strong>第 '+idx+' 轮</strong><button class="btn btn-ghost btn-sm" type="button" style="margin-left:auto;color:var(--c-red)" onclick="removeAgentTurnCard(this)">删除轮次</button></div>'+
        '<div class="fg"><label class="fl">用户输入</label><textarea class="fi ce-agent-input" rows="3" placeholder="用户本轮输入">'+esc((turn&&turn.userInput)||'')+'</textarea></div>'+
        '<div class="fg"><label class="fl">本轮中间链路评测点</label><div class="agent-eval-rows"></div></div>';
    ct.appendChild(d);
    var evals=Array.isArray(turn&&turn.evaluations)&&turn.evaluations.length?turn.evaluations:legacyTurnEvaluations(turn||{});
    activeStageDefinitions().forEach(function(stage,stageIdx){addStageEvalRow(d,stage,evalByStage(evals,stage.key),stageIdx+1);});
    renumberAgentTurns();
}
function removeAgentTurnCard(btn){
    var card=btn.closest('.agent-turn-card');
    if(card) card.remove();
    renumberAgentTurns();
}
function renumberAgentTurns(){
    document.querySelectorAll('#agent-turns-ct .agent-turn-card').forEach(function(card,i){
        var n=card.querySelector('.eval-card-num');
        var title=card.querySelector('.eval-card-head strong');
        if(n)n.textContent=i+1;
        if(title)title.textContent='第 '+(i+1)+' 轮';
    });
}
function legacyTurnEvaluations(turn){
    var evals=[];
    if(turn.expectedTool) evals.push({stageKey:'functionInvocation',evalType:'structure_match',expected:turn.expectedTool});
    if(turn.expectedArgs) evals.push({stageKey:'inputConditionRetention',evalType:'structure_match',expected:valueOrEmpty(turn.expectedArgs)});
    if((turn.replyContains||[]).length||(turn.replyNotContains||[]).length) evals.push({stageKey:'replyFaithfulness',evalType:'text_match',expected:JSON.stringify({contains:turn.replyContains||[],notContains:turn.replyNotContains||[]})});
    if(turn.judgePrompt||turn.judgeThreshold) evals.push({stageKey:'responseQuality',evalType:'llm_judge',expected:turn.judgePrompt||('threshold='+(turn.judgeThreshold||0.8))});
    return evals;
}
function addStageEvalRow(card,stage,ev,stageNo){
    var box=card&&card.querySelector('.agent-eval-rows');
    if(!box)return;
    var stageKey=stage.key;
    var evalType=(ev&&ev.evalType)||stageDefaultEvalType(stageKey);
    var checked=!!ev;
    var row=document.createElement('div');
    row.className='eval-card agent-eval-row';
    row.style.background='#fff';
    row.innerHTML='<div class="eval-grid" style="grid-template-columns:210px 150px minmax(0,1fr)">'+
        '<div class="fg"><label class="fl">Stage</label><label class="fi" style="display:flex;align-items:center;gap:8px;background:#f8fafc;color:var(--c-text2);font-weight:700;cursor:pointer"><input type="checkbox" class="agent-stage-enabled" onchange="toggleStageEvalRow(this)"'+(checked?' checked':'')+'> <span>'+esc((stageNo||box.children.length+1)+'. '+stage.label)+'</span></label><input type="hidden" class="agent-stage" value="'+ea(stageKey)+'"></div>'+
        '<div class="fg"><label class="fl">评测类型</label><select class="fi agent-eval-type">'+evalTypeOptions(evalType)+'</select></div>'+
        '<div class="fg"><label class="fl">期望/规则</label><textarea class="fi eval-arg-ta agent-expected" rows="3" placeholder="结构 JSON / 关键文本 JSON / 语义标准">'+esc((ev&&ev.expected)||'')+'</textarea></div>'+
        '</div>';
    box.appendChild(row);
    toggleStageEvalRow(row.querySelector('.agent-stage-enabled'));
}
function toggleStageEvalRow(ck){
    var row=ck&&ck.closest('.agent-eval-row');
    if(!row)return;
    var disabled=!ck.checked;
    row.querySelectorAll('.agent-eval-type,.agent-expected').forEach(function(el){el.disabled=disabled;});
    row.style.opacity=disabled?'0.62':'1';
}
function renderVoiceCaseStageFields(doc){
    var ct=document.getElementById('eval-ct');
    var payload=doc.payload||{};
    var ticket=payload.expectedTicket||{};
    var dialogue=payload.dialogueText||doc.input1||caseInputs(doc)[0]||'';
    var missing=Array.isArray(ticket.missingFields)?ticket.missingFields.join('|'):'';
    var noise=Array.isArray(payload.noiseTags)?payload.noiseTags.join('|'):(doc.tags||'');
    var evals=voiceStageEvaluationsFromDoc(doc,ticket,missing,noise);
    ct.innerHTML='<div class="turns-box" style="margin-top:0">'+
        '<div class="eval-card agent-turn-card" id="voice-stage-card">'+
        '<div class="eval-card-head"><span class="eval-card-num">1</span><strong>ASR 对话</strong></div>'+
        '<div class="fg"><label class="fl">用户每轮输入 / ASR 对话文本</label><textarea class="fi ce-agent-input" id="ce-voice-dialogue" rows="6" placeholder="坐席：...&#10;用户：...">'+esc(dialogue)+'</textarea></div>'+
        '<div class="fg"><label class="fl">本轮中间链路评测点</label><div class="agent-eval-rows"></div></div>'+
        '</div></div>';
    var card=document.getElementById('voice-stage-card');
    activeStageDefinitions().forEach(function(stage,stageIdx){addStageEvalRow(card,stage,evalByStage(evals,stage.key),stageIdx+1);});
}
function voiceStageEvaluationsFromDoc(doc,ticket,missing,noise){
    var existing=((doc.turns||[])[0]&&((doc.turns||[])[0].evaluations))||[];
    if(existing.length) return existing;
    if(!Object.keys(ticket||{}).length&&!doc.expected_arg_3&&!noise) return [];
    var route=ticket.routeQueue||ticket.routeTo||'';
    return [
        {stageKey:'asrTranscription',evalType:'text_match',expected:noise?('noiseTags='+noise):'关键事实可回溯到 ASR 对话'},
        {stageKey:'fieldExtraction',evalType:'structure_match',expected:JSON.stringify(ticket||{},null,2)},
        {stageKey:'ticketStructure',evalType:'structure_match',expected:JSON.stringify({routeQueue:route,missingFields:splitAssertList(missing)},null,2)},
        {stageKey:'semanticQuality',evalType:'llm_judge',expected:(doc.expected_arg_3||'threshold=0.8')}
    ];
}
function readEvalEditors(){
    var slots=[];
    for(var i=1;i<=3;i++){
        var typeEl=document.querySelector('.ev-type[data-index="'+i+'"]');
        var argEl=document.querySelector('.ev-arg[data-index="'+i+'"]');
        var judgeEl=document.querySelector('.ev-judge[data-index="'+i+'"]');
        var evalType=canonicalEvalType((typeEl&&typeEl.value.trim())||'');
        var expectedArg=(argEl&&argEl.value.trim())||'';
        var judgePromptId=(judgeEl&&judgeEl.value.trim())||'';
        if(!evalType&&!expectedArg&&!judgePromptId) continue;
        if(!evalType){
            toast('评测点 '+i+' 已填写参数或 Prompt，但 eval_type 为空','err');
            return null;
        }
        slots.push({index:i,evalType:evalType,expectedArg:expectedArg,judgePromptId:judgePromptId});
    }
    return slots;
}
function buildCompatibilityTurnsFromSchema(doc,slots){
    var inputs=[doc.input1,doc.input2,doc.input3].map(function(v){return String(v||'').trim();});
    var turns=inputs.map(function(inp,i){return inp?{turnIndex:i+1,userInput:inp}:null;}).filter(Boolean);
    if(!turns.length) return [];
    var target=turns[turns.length-1];
    var toolSlot=(slots||[]).find(function(s){return canonicalEvalType(s.evalType)==='structure_match';});
    var replySlot=(slots||[]).find(function(s){return canonicalEvalType(s.evalType)==='text_match';});
    var judgeSlot=(slots||[]).find(function(s){return canonicalEvalType(s.evalType)==='llm_judge';});
    if(toolSlot){
        var toolArg=parseExpectedArg(toolSlot.expectedArg)||{};
        target.expectedTool=toolArg.tool||toolSlot.expectedArg||'';
        target.expectedArgs=toolArg.args!==undefined?toolArg.args:(toolArg.tool?toolArg:{});
    }
    if(replySlot){
        var replyArg=parseExpectedArg(replySlot.expectedArg)||{};
        target.replyContains=Array.isArray(replyArg.contains)?replyArg.contains:splitAssertList(replySlot.expectedArg);
        target.replyNotContains=Array.isArray(replyArg.notContains)?replyArg.notContains:[];
    }
    if(judgeSlot){
        var judgeArg=parseExpectedArg(judgeSlot.expectedArg)||{};
        target.judgePrompt=judgeSlot.judgePromptId||judgeArg.criteria||'';
        target.judgeThreshold=judgeArg.threshold!==undefined?judgeArg.threshold:'';
    }
    return turns;
}
function buildVoicePayloadFromSchema(doc,slots){
    var structureSlots=(slots||[]).filter(function(s){return canonicalEvalType(s.evalType)==='structure_match';});
    var structureSlot=structureSlots[0];
    var paramSlot=structureSlots[1];
    var expectedTicket=parseExpectedArg(structureSlot&&structureSlot.expectedArg)||{};
    var paramArg=parseExpectedArg(paramSlot&&paramSlot.expectedArg)||{};
    if(Array.isArray(paramArg.missingFields)) expectedTicket.missingFields=paramArg.missingFields;
    return {
        dialogueText:doc.input1||'',
        expectedTicket:expectedTicket,
        assertions:{},
        noiseTags:splitAssertList(doc.tags)
    };
}
function csvListText(v){
    if(Array.isArray(v)) return v.join('|');
    return v||'';
}
function addTurn(inp,tool,eargs,rc,rnc,jp,jt){
    var ct=document.getElementById('turns-ct'), idx=ct.querySelectorAll('.turn-r').length+1, d=document.createElement('div');
    d.className='turn-r';
    d.innerHTML='<span class="turn-n">'+idx+'</span>'+
        '<input class="fi t-inp" placeholder="用户输入" value="'+ea(inp||'')+'">'+
        '<select class="fi tool-fi">'+buildToolOptions(tool||'')+'</select>'+
        '<button class="btn btn-ghost btn-sm" style="color:var(--c-red)" onclick="rmTurn(this)">x</button>'+
        '<input class="fi reply-fi eargs-fi" placeholder="期望参数(JSON)" value="'+ea(eargs||'')+'">'+
        '<input class="fi reply-fi rc-fi" placeholder="回复须含(分号分隔)" value="'+ea(rc||'')+'">'+
        '<input class="fi reply-fi rnc-fi" placeholder="回复禁含(分号分隔)" value="'+ea(rnc||'')+'">'+
        '<textarea class="fi reply-fi jp-fi" placeholder="LLM评判prompt(留空则不启用)" rows="2">'+esc(jp||'')+'</textarea>'+
        '<input class="fi reply-fi jt-fi" placeholder="评判及格线(0-1 默认0.7)" style="width:180px" value="'+ea(jt!=null&&jt!==''?jt:'')+'">';
    ct.appendChild(d);
}
function rmTurn(b){ b.closest('.turn-r').remove(); document.querySelectorAll('#turns-ct .turn-r').forEach(function(r,i){r.querySelector('.turn-n').textContent=i+1;}); }
function editCase(id){ fetch(BASE+'/api/cases/'+id).then(r=>r.json()).then(d=>{if(d.code==='10000')openCaseModal(d.data);else toast('加载失败','err');}); }
function delCase(id,cid){ if(!confirm('删除用例 '+cid+' ?'))return; fetch(BASE+'/api/cases/'+id,{method:'DELETE'}).then(r=>r.json()).then(d=>{if(d.code==='10000'){toast('已删除','ok');loadCases();}else toast('删除失败','err');}); }
function splitAssertList(v){
    return String(v||'').split(/[|,，\n]/).map(function(x){return x.trim();}).filter(Boolean);
}
function collectStageEvaluationsFromCard(card){
    var evals=[];
    (card?card.querySelectorAll('.agent-eval-row'):[]).forEach(function(row){
        var enabled=row.querySelector('.agent-stage-enabled');
        if(enabled&&!enabled.checked) return;
        var stageKey=(row.querySelector('.agent-stage')||{}).value||'';
        var evalType=(row.querySelector('.agent-eval-type')||{}).value||'';
        var expected=(row.querySelector('.agent-expected')||{}).value||'';
        if(!stageKey&&!evalType&&!expected.trim()) return;
        evals.push({stageKey:stageKey,evalType:canonicalEvalType(evalType),expected:expected.trim()});
    });
    return evals;
}
function saveCase(){
    var id=document.getElementById('ce-id').value;
    var doc={caseId:document.getElementById('ce-caseId').value.trim(),name:document.getElementById('ce-name').value.trim(),
        userId:document.getElementById('ce-uid').value.trim(),tags:document.getElementById('ce-tags').value.trim(),
        groupName:document.getElementById('ce-group').value.trim()||'默认分组',
        source:'manual',
        evalDimensions:activeStageDefinitions().map(function(stage){return stage.key;}),
        regression:false,
        enabled:true};
    doc.template_id=(document.getElementById('ce-template')||{}).value||'';
    doc.expected={};
    document.querySelectorAll('#ce-template-expected-fields .ce-expected-field').forEach(function(el){
        var key=el.getAttribute('data-key');
        if(!key) return;
        doc.expected[key]=el.value.trim();
    });
    if(!doc.caseId){toast('Case ID 必填','err');return;}
    if(!doc.name){toast('名称必填','err');return;}
    if(!doc.template_id){toast('请选择评测模板','err');return;}
    if(doc.template_id){
        var simpleInput=((document.getElementById('ce-simple-input')||{}).value||'').trim();
        if(!simpleInput){toast('用户输入必填','err');return;}
        doc.caseType=activeCaseType();
        doc.input1=simpleInput;
        doc.input2='';
        doc.input3='';
        doc.turns=[{turnIndex:1,userInput:simpleInput,evaluations:[]}];
        doc.expectedTools=[];
        doc.allowedTools=[];
        var urlSimple=id?BASE+'/api/cases/'+id:BASE+'/api/cases', methodSimple=id?'PUT':'POST';
        fetch(urlSimple,{method:methodSimple,headers:{'Content-Type':'application/json'},body:JSON.stringify(doc)})
            .then(r=>r.json()).then(d=>{if(d.code==='10000'){toast('已保存','ok');closeCM();loadCases();}else toast('保存失败: '+d.message,'err');})
            .catch(e=>toast('请求异常','err'));
        return;
    }
    if(activeCaseType()==='voice_ticket_dialogue') {
        var dialogue=(document.getElementById('ce-voice-dialogue')||{}).value||'';
        if(!dialogue.trim()){toast('dialogue_text 必填','err');return;}
        var voiceEvals=collectStageEvaluationsFromCard(document.getElementById('voice-stage-card'));
        var fieldEval=voiceEvals.find(function(ev){return ev.stageKey==='fieldExtraction';})||{};
        var structureEval=voiceEvals.find(function(ev){return ev.stageKey==='ticketStructure';})||{};
        var semanticEval=voiceEvals.find(function(ev){return ev.stageKey==='semanticQuality';})||{};
        var ticket=parseExpectedArg(fieldEval.expected||'{}')||{};
        if(fieldEval.expected&&(!ticket||typeof ticket!=='object')){toast('字段抽取的期望/规则必须是 JSON 对象','err');return;}
        var structure=parseExpectedArg(structureEval.expected||'{}')||{};
        var missing=Array.isArray(structure.missingFields)?structure.missingFields:splitAssertList(structure.missingFields||ticket.missingFields||'');
        var route=String(structure.routeQueue||structure.routeTo||ticket.routeQueue||ticket.routeTo||'').trim();
        var noise=splitAssertList(doc.tags);
        if(missing.length) ticket.missingFields=missing;
        if(route) ticket.routeQueue=route;
        doc.caseType='voice_ticket_dialogue';
        doc.input1=dialogue.trim();
        doc.input2='';
        doc.input3='';
        doc.tags=noise.join(',');
        doc.riskLevel='medium';
        doc.payload={dialogueText:doc.input1,expectedTicket:ticket,assertions:{},noiseTags:noise};
        doc.turns=[{turnIndex:1,userInput:doc.input1,evaluations:voiceEvals}];
        doc.expectedTools=[];
        doc.eval_type_1='text_match';
        doc.expected_arg_1='dialogueGrounding';
        doc.eval_type_2='structure_match';
        doc.expected_arg_2=JSON.stringify(ticket);
        doc.eval_type_3='llm_judge';
        doc.expected_arg_3=semanticEval.expected||'threshold=0.8';
        doc.judge_prompt_id_3='voice-ticket-semantic-eval-prompt';
    } else {
        var turns=[];
        var hasInvalidEval=false;
        document.querySelectorAll('#agent-turns-ct .agent-turn-card').forEach(function(card,i){
            var input=(card.querySelector('.ce-agent-input')||{}).value||'';
            if(!input.trim()&&!card.querySelectorAll('.agent-eval-row').length) return;
            if(!input.trim()){toast('第 '+(i+1)+' 轮用户输入不能为空','err');hasInvalidEval=true;return;}
            var evals=collectStageEvaluationsFromCard(card);
            if(evals.some(function(ev){return !ev.stageKey||!ev.evalType;})){toast('第 '+(i+1)+' 轮存在未配置完整的评测点','err');hasInvalidEval=true;return;}
            if(!evals.length){toast('第 '+(i+1)+' 轮至少配置一个中间链路评测点','err');hasInvalidEval=true;return;}
            var toolEval=evals.find(function(ev){return ev.stageKey==='functionInvocation'||ev.stageKey==='intent';})||{};
            var paramEval=evals.find(function(ev){return ev.stageKey==='inputConditionRetention';})||{};
            var replyEval=evals.find(function(ev){return ev.stageKey==='replyFaithfulness';})||{};
            var judgeEval=evals.find(function(ev){return ev.stageKey==='responseQuality';})||{};
            var toolArg=parseExpectedArg(toolEval.expected)||{};
            var expectedTool=toolArg.tool||toolEval.expected||'';
            var replyArg=parseExpectedArg(replyEval.expected)||{};
            var contains=Array.isArray(replyArg.contains)?replyArg.contains:splitAssertList(replyEval.expected||'');
            var notContains=Array.isArray(replyArg.notContains)?replyArg.notContains:[];
            var thresholdMatch=/threshold\s*[:=]\s*([0-9.]+)/i.exec(judgeEval.expected||'');
            var threshold=thresholdMatch?thresholdMatch[1]:'';
            turns.push({
                turnIndex:turns.length+1,
                userInput:input.trim(),
                expectedTool:expectedTool,
                expectedArgs:paramEval.expected||'',
                replyContains:contains,
                replyNotContains:notContains,
                judgePrompt:judgeEval.expected||'',
                judgeThreshold:threshold,
                evaluations:evals
            });
        });
        if(hasInvalidEval) return;
        if(!turns.length){toast('至少填写一轮 Agent 输入','err');return;}
        doc.caseType='vehicle_agent_turns';
        doc.input1=turns[0]&&turns[0].userInput||'';
        doc.input2=turns[1]&&turns[1].userInput||'';
        doc.input3=turns[2]&&turns[2].userInput||'';
        doc.turns=turns;
        doc.expectedTools=turns.map(function(t){return t.expectedTool;}).filter(Boolean);
        doc.allowedTools=[].concat(doc.expectedTools).filter(function(v,i,a){return v&&a.indexOf(v)===i;});
        var finalTurn=turns[turns.length-1]||{};
        doc.eval_type_1='structure_match';
        doc.expected_arg_1=JSON.stringify({tool:finalTurn.expectedTool||'',args:parseExpectedArg(finalTurn.expectedArgs)||finalTurn.expectedArgs||{}});
        doc.eval_type_2='text_match';
        doc.expected_arg_2=JSON.stringify({contains:finalTurn.replyContains||[]});
        doc.eval_type_3='llm_judge';
        doc.expected_arg_3='threshold='+(finalTurn.judgeThreshold||0.8);
        doc.judge_prompt_id_3=finalTurn.judgePrompt||'agent-semantic-eval-prompt';
        doc.caseType='vehicle_agent_turns';
    }
    var url=id?BASE+'/api/cases/'+id:BASE+'/api/cases', method=id?'PUT':'POST';
    fetch(url,{method:method,headers:{'Content-Type':'application/json'},body:JSON.stringify(doc)})
        .then(r=>r.json()).then(d=>{if(d.code==='10000'){toast('已保存','ok');closeCM();loadCases();}else toast('保存失败: '+d.message,'err');})
        .catch(e=>toast('请求异常','err'));
}
