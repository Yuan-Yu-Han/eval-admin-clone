var _templatePresets = [];
var _activeTemplateId = '';

function resetTemplatesState(){
    _templatePresets=[];
    _activeTemplateId='';
}
window.resetTemplatesState = resetTemplatesState;

function loadTemplates(){
    fetch(BASE+'/api/templates').then(function(r){return r.json();}).then(function(d){
        if(d.code!=='10000'){toast('加载模板失败: '+d.message,'err');return;}
        _templatePresets=(d.data&&d.data.templates||[]).map(function(t){return Object.assign({source:'preset'},t);});
        if(!_activeTemplateId){
            var first=templateList()[0];
            if(first) _activeTemplateId=first.templateId;
        }
        renderTemplates();
    }).catch(function(){toast('请求模板异常','err');});
}

function templateList(){
    return _templatePresets;
}

function currentTemplate(){
    return templateList().find(function(t){return t.templateId===_activeTemplateId;})||templateList()[0]||null;
}

function filterTemplates(){
    renderTemplates();
}

function selectTemplate(templateId){
    _activeTemplateId=templateId;
    renderTemplates();
}

function templateMatchesQuery(t,q){
    if(!q) return true;
    var text=[
        t.templateId,
        t.name,
        t.summary,
        (t.resultLabels||[]).join(' '),
        (t.stages||[]).map(function(s){return [s.name,s.eval_type,s.method,s.prompt_id,(s.match_fields||[]).join(' ')].join(' ');}).join(' ')
    ].join(' ').toLowerCase();
    return text.indexOf(q)>=0;
}

function renderTemplates(){
    var list=document.getElementById('template-list');
    var detail=document.getElementById('template-detail');
    if(!list||!detail) return;
    var q=(document.getElementById('template-q')&&document.getElementById('template-q').value||'').trim().toLowerCase();
    var visible=templateList().filter(function(t){return templateMatchesQuery(t,q);});
    if(visible.length&&!visible.some(function(t){return t.templateId===_activeTemplateId;})) _activeTemplateId=visible[0].templateId;
    list.innerHTML=visible.length?visible.map(templateListItem).join(''):'<div class="empty">没有匹配的模板</div>';
    var t=currentTemplate();
    detail.innerHTML=t?templateEditor(t):'<div class="empty">点击「新建模板」开始配置</div>';
    applyButtonTooltips(document.getElementById('p-templates'));
}

function templateListItem(t){
    var active=t.templateId===_activeTemplateId;
    var badge=t.source==='draft'?'已保存':'内置';
    return '<button class="template-list-item '+(active?'active':'')+'" onclick="selectTemplate(\''+ea(t.templateId)+'\')">'+
        '<span class="template-list-name">'+esc(t.name)+'</span>'+
        '<span class="template-list-meta">'+esc(badge)+' · '+(t.stages||[]).length+' 个检查点</span>'+
        '<span class="template-list-functions">'+esc(t.summary||'')+'</span>'+
    '</button>';
}

function templateEditor(t){
    return '<div class="template-detail-head">'+
        '<div>'+
            '<div class="template-title-row">'+
                '<input class="template-title-input" value="'+ea(t.name||'')+'" oninput="updateTemplateField(\'name\',this.value)">'+
                '<span class="tag '+(t.source==='draft'?'tag-wait':'tag-done')+'">'+(t.source==='draft'?'已保存草稿':'内置模板')+'</span>'+
            '</div>'+
            '<textarea class="template-summary-input" oninput="updateTemplateField(\'summary\',this.value)">'+esc(t.summary||'')+'</textarea>'+
        '</div>'+
    '</div>'+
    '<div class="template-stage-head">'+
        '<div class="template-stage-head-title">检查点</div>'+
        '<button class="btn btn-flat btn-sm" onclick="addTemplateStage()">新增检查点</button>'+
    '</div>'+
    '<div class="template-stage-flow">'+(t.stages||[]).map(function(stage,idx){return templateStageEditor(stage,idx);}).join('')+'</div>';
}

function templateStageEditor(stage,idx){
    var isLlm=stage.eval_type==='llm_judge';
    var isReply=stage.eval_type==='text_match';
    var isStructure=stage.eval_type==='structure_match';
    var evalOptions=[
        ['structure_match','字段检查'],
        ['text_match','回复检查'],
        ['llm_judge','LLM 评审']
    ].map(function(item){return '<option value="'+item[0]+'" '+(stage.eval_type===item[0]?'selected':'')+'>'+item[1]+'</option>';}).join('');
    var methodOptions='';
    if(isLlm){
        methodOptions=[
            ['binary_judge','Pass / Fail'],
            ['rubric_score','0-100 打分']
        ].map(function(item){return '<option value="'+item[0]+'" '+((stage.method||'binary_judge')===item[0]?'selected':'')+'>'+item[1]+'</option>';}).join('');
    }else if(isStructure){
        methodOptions=[
            ['exact_match','完全一致'],
            ['json_subset_match','包含'],
            ['json_path_exists','字段存在']
        ].map(function(item){return '<option value="'+item[0]+'" '+((stage.method||'exact_match')===item[0]?'selected':'')+'>'+item[1]+'</option>';}).join('');
    }else if(isReply){
        methodOptions=[
            ['contains','包含文本'],
            ['contains_and_not_contains','包含且不包含'],
            ['exact_match','完全一致'],
            ['regex_match','正则匹配']
        ].map(function(item){return '<option value="'+item[0]+'" '+((stage.method||'contains')===item[0]?'selected':'')+'>'+item[1]+'</option>';}).join('');
    }
    var configHtml='';
    if(isLlm){
        var promptContent=stage.prompt_content||'';
        configHtml+=
            '<div class="template-config-grid">'+
                '<div class="fg template-field-full"><label class="fl">评审 Prompt</label><textarea class="fi template-prompt-textarea" rows="7" placeholder="请判断最终回复是否解决用户问题。只输出 pass/fail 和原因。" oninput="updateTemplateStage('+idx+',\'prompt_content\',this.value)">'+esc(promptContent)+'</textarea></div>'+
            '</div>';
        if((stage.method||'binary_judge')==='rubric_score'){
            configHtml+=
                '<div class="template-config-grid">'+
                    '<div class="fg template-field-score"><label class="fl">通过分数</label><input class="fi" type="number" min="0" max="100" step="1" value="'+ea(displayJudgeThreshold(stage.judge_threshold))+'" placeholder="80" oninput="updateTemplateStage('+idx+',\'judge_threshold\',this.value)"></div>'+
                '</div>';
        }
    }
    if(isStructure){
        if((stage.method||'exact_match')!=='json_path_exists'){
            configHtml+=
                '<div class="template-config-grid">'+
                    '<div class="fg"><label class="fl">Case 填写项</label><input class="fi" value="'+ea(stage.case_field_label||displayExpectedContent(stage)||'期望值')+'" placeholder="例如：期望值" oninput="updateTemplateStage('+idx+',\'case_field_label\',this.value)"></div>'+
                '</div>';
        }
    }
    if(isReply){
        if((stage.method||'contains')==='contains'){
            configHtml+='<div class="template-config-grid">'+
                '<div class="fg"><label class="fl">Case 填写项</label><input class="fi" value="'+ea(stage.case_include_label||'回复必须包含')+'" placeholder="例如：回复必须包含" oninput="updateTemplateStage('+idx+',\'case_include_label\',this.value)"></div>'+
            '</div>';
        }else if(stage.method==='contains_and_not_contains'){
            configHtml+='<div class="template-config-grid">'+
                '<div class="fg"><label class="fl">必须包含填写项</label><input class="fi" value="'+ea(stage.case_include_label||'回复必须包含')+'" placeholder="例如：回复必须包含" oninput="updateTemplateStage('+idx+',\'case_include_label\',this.value)"></div>'+
                '<div class="fg"><label class="fl">不能包含填写项</label><input class="fi" value="'+ea(stage.case_exclude_label||'回复不能包含')+'" placeholder="例如：回复不能包含" oninput="updateTemplateStage('+idx+',\'case_exclude_label\',this.value)"></div>'+
            '</div>';
        }else if(stage.method==='exact_match'){
            configHtml+='<div class="template-config-grid">'+
                '<div class="fg"><label class="fl">Case 填写项</label><input class="fi" value="'+ea(stage.case_exact_label||'期望完整回复')+'" placeholder="例如：期望完整回复" oninput="updateTemplateStage('+idx+',\'case_exact_label\',this.value)"></div>'+
                '<div class="fg"><label class="fl">比较选项</label><label class="fcheck"><input type="checkbox" '+(stage.ignore_whitespace?'checked':'')+' onchange="updateTemplateStage('+idx+',\'ignore_whitespace\',this.checked)"> 忽略空格</label><label class="fcheck"><input type="checkbox" '+(stage.ignore_punctuation?'checked':'')+' onchange="updateTemplateStage('+idx+',\'ignore_punctuation\',this.checked)"> 忽略标点</label></div>'+
            '</div>';
        }else if(stage.method==='regex_match'){
            configHtml+='<div class="template-config-grid">'+
                '<div class="fg"><label class="fl">Case 填写项</label><input class="fi" value="'+ea(stage.case_regex_label||'正则规则')+'" placeholder="例如：正则规则" oninput="updateTemplateStage('+idx+',\'case_regex_label\',this.value)"></div>'+
            '</div>';
        }
    }
    return '<div class="template-stage-card">'+
        '<div class="template-stage-index">'+(idx+1)+'</div>'+
        '<div class="template-stage-main">'+
            '<div class="template-stage-card-head">'+
                '<div class="fg template-stage-name"><label class="fl">检查点名称</label><input class="fi" value="'+ea(stage.name||'')+'" oninput="updateTemplateStage('+idx+',\'name\',this.value)"></div>'+
                '<button class="btn btn-ghost btn-sm" style="color:var(--c-red)" onclick="deleteTemplateStage('+idx+')">删除检查点</button>'+
            '</div>'+
            '<div class="template-rule-grid">'+
                '<div class="fg"><label class="fl">检查方式</label><select class="fi" onchange="updateTemplateStage('+idx+',\'eval_type\',this.value,true)">'+evalOptions+'</select></div>'+
                '<div class="fg"><label class="fl">'+(isLlm?'评审方式':'检查规则')+'</label><select class="fi" onchange="updateTemplateStage('+idx+',\'method\',this.value,true)">'+methodOptions+'</select></div>'+
            '</div>'+
            '<div class="template-config-panel">'+configHtml+'</div>'+
            '<label class="fcheck template-block-check"><input type="checkbox" '+(stage.blocks_downstream_on_fail?'checked':'')+' onchange="updateTemplateStage('+idx+',\'blocks_downstream_on_fail\',this.checked)"> 失败后不再继续</label>'+
        '</div>'+
    '</div>';
}

function editableTemplate(){
    var t=currentTemplate();
    if(!t) return null;
    return t;
}

function updateTemplateField(key,value){
    var t=editableTemplate();
    if(!t) return;
    t[key]=value;
    _activeTemplateId=t.templateId;
}

function updateTemplateStage(idx,key,value){
    var t=editableTemplate();
    if(!t||!t.stages||!t.stages[idx]) return;
    if(key==='required_case_fields'||key==='match_fields'||key==='include_fields'||key==='exclude_fields'||key==='required_fields') value=String(value||'').split(',').map(function(v){return v.trim();}).filter(Boolean);
    if(key==='judge_threshold') value=value===''?'':Number(value);
    if(key==='depends_on'&&!value) value=null;
    t.stages[idx][key]=value;
    if(key==='name'&&t.stages[idx].eval_type==='structure_match'){
        if(!t.stages[idx].target_field||['function_name','arguments','intermediate_calls','intent'].includes(t.stages[idx].target_field)){
            t.stages[idx].target_field=inferStructureTargetField(t.stages[idx]);
        }
    }
    if(key==='eval_type') applyDefaultStageMethod(t.stages[idx],true);
    if(key==='method') applyDefaultStageMethod(t.stages[idx],false);
    _activeTemplateId=t.templateId;
    if(arguments[3]) renderTemplates();
}

function inferStructureTargetField(stage){
    var text=((stage&&stage.key||'')+' '+(stage&&stage.name||'')).toLowerCase();
    if(/意图|intent/.test(text)) return 'intent';
    if(/中间调用|intermediate/.test(text)) return 'intermediate_calls';
    if(/参数|inputconditionretention|argument|args/.test(text)) return 'arguments';
    return 'function_name';
}

function displayJudgeThreshold(value){
    if(value===''||value===null||value===undefined) return '';
    var n=Number(value);
    if(!isFinite(n)) return value;
    return n>0&&n<=1?Math.round(n*100):n;
}

function displayExpectedContent(stage){
    if(stage.expected_content) return stage.expected_content;
    if(stage.expected_value) return stage.expected_value;
    if(stage.expected_object) return stage.expected_object;
    if(stage.required_fields&&stage.required_fields.length) return stage.required_fields.join(', ');
    return '';
}

function defaultPassFailPrompt(){
    return [
        '你是一个 AI 评测员，请根据用户原始问题、系统/工具执行结果和最终回复，判断这个检查点是否通过。',
        '',
        '评审目标：判断最终回复是否完成了当前检查点要求，是否准确、完整、没有编造，并且没有把失败状态描述成成功。',
        '',
        '通过标准：',
        '1. 回复直接回应用户需求，没有答非所问。',
        '2. 回复内容与工具调用或检索结果一致，没有凭空补充事实。',
        '3. 如果任务已经成功执行，回复需要清楚表达成功结果；如果任务失败或信息不足，回复需要如实说明。',
        '4. 回复没有遗漏会影响用户理解的关键信息。',
        '',
        '失败标准：',
        '1. 回复与实际执行结果冲突。',
        '2. 回复缺少关键结论，用户无法知道任务是否完成。',
        '3. 出现没有依据的事实、数据、状态或承诺。',
        '4. 用模糊话术掩盖失败、权限不足或信息缺失。',
        '',
        '请只输出 JSON：',
        '{"pass": true/false, "reason": "一句话说明原因"}'
    ].join('\n');
}

function defaultScorePrompt(){
    return [
        '你是一个 AI 评测员，请对最终回复进行 0-100 分评分。',
        '',
        '评分目标：衡量最终回复是否准确完成用户需求，是否忠实于可用上下文或工具结果，表达是否清楚、完整、可信。',
        '',
        '评分参考：',
        '90-100：完全回答用户问题，事实准确，关键信息完整，表达清楚，没有幻觉。',
        '75-89：基本正确，但存在轻微遗漏、表达不够清楚或细节不够完整。',
        '60-74：部分回答正确，但遗漏重要信息，或需要用户额外追问才能理解结果。',
        '1-59：明显答非所问、事实错误、与工具结果冲突，或出现较严重幻觉。',
        '0：没有有效回答，或回复完全不可用。',
        '',
        '请重点检查：',
        '1. 是否真正解决用户问题。',
        '2. 是否忠实于工具调用、检索结果或已知上下文。',
        '3. 是否遗漏必要的状态、对象、参数、数据口径或失败原因。',
        '4. 是否出现未经依据支持的结论。',
        '',
        '请只输出 JSON：',
        '{"score": 0-100, "pass": true/false, "reason": "一句话说明主要扣分点"}'
    ].join('\n');
}

function applyDefaultStageMethod(stage,typeChanged){
    if(stage.eval_type==='structure_match'){
        if(typeChanged||!['exact_match','json_subset_match','json_path_exists'].includes(stage.method)) stage.method='exact_match';
        if(!stage.case_field_label) stage.case_field_label=stage.expected_content||displayExpectedContent(stage)||'期望值';
        if(!stage.target_field) stage.target_field=inferStructureTargetField(stage);
        if(typeChanged){
            stage.case_field_label='期望值';
            stage.target_field=inferStructureTargetField(stage);
        }
    }
    if(stage.eval_type==='text_match'){
        if(typeChanged||!['contains','contains_and_not_contains','exact_match','regex_match'].includes(stage.method)) stage.method='contains';
        if((stage.method==='contains'||stage.method==='contains_and_not_contains')&&(!stage.include_fields||!stage.include_fields.length)) stage.include_fields=['已完成'];
        if((stage.method==='contains'||stage.method==='contains_and_not_contains')&&!stage.case_include_label) stage.case_include_label='回复必须包含';
        if(stage.method==='contains_and_not_contains'&&!stage.case_exclude_label) stage.case_exclude_label='回复不能包含';
        if(stage.method==='exact_match'&&!stage.expected_text) stage.expected_text='已为你处理完成。';
        if(stage.method==='exact_match'&&!stage.case_exact_label) stage.case_exact_label='期望完整回复';
        if(stage.method==='regex_match'&&!stage.regex_pattern) stage.regex_pattern='订单号[:：]?\\s*[A-Z0-9]{6,}';
        if(stage.method==='regex_match'&&!stage.case_regex_label) stage.case_regex_label='正则规则';
        if(typeChanged){
            stage.include_fields=['已完成'];
            stage.exclude_fields=[];
            stage.expected_text='';
            stage.regex_pattern='';
            stage.regex_note='';
            stage.case_include_label='回复必须包含';
            stage.case_exclude_label='回复不能包含';
            stage.case_exact_label='期望完整回复';
            stage.case_regex_label='正则规则';
        }
    }
    if(stage.eval_type==='llm_judge'){
        if(typeChanged||!['binary_judge','rubric_score'].includes(stage.method)) stage.method='binary_judge';
        if(!stage.prompt_content) stage.prompt_content=stage.method==='rubric_score'?defaultScorePrompt():defaultPassFailPrompt();
        if(stage.method==='rubric_score'){
            stage.judge_threshold=displayJudgeThreshold(stage.judge_threshold||80);
        }
        if(typeChanged){
            stage.prompt_content=stage.method==='rubric_score'?defaultScorePrompt():defaultPassFailPrompt();
            stage.judge_threshold=displayJudgeThreshold(stage.judge_threshold||80);
        }
    }
}

function newTemplate(){
    var t={
        templateId:'template_'+Date.now(),
        name:'新的评测模板',
        source:'draft',
        summary:'描述这个模板适合评测什么业务质量。',
        resultLabels:['新检查点'],
        stages:[{
            key:'stage1',
            name:'新检查点',
            eval_type:'llm_judge',
            method:'binary_judge',
            depends_on:null,
            prompt_content:defaultPassFailPrompt(),
            judge_threshold:80,
            blocks_downstream_on_fail:false,
            match_fields:[],
            required_case_fields:[],
            description:''
        }]
    };
    _templatePresets.unshift(t);
    _activeTemplateId=t.templateId;
    renderTemplates();
}

function addTemplateStage(){
    var t=editableTemplate();
    if(!t) return;
    t.stages=t.stages||[];
    t.stages.push({
        key:'stage'+(t.stages.length+1),
        name:'新检查点',
        eval_type:'structure_match',
        method:'exact_match',
        depends_on:t.stages.length?t.stages[t.stages.length-1].key:null,
        prompt_id:'',
        prompt_content:'',
        judge_threshold:80,
        blocks_downstream_on_fail:false,
        case_field_label:'期望值',
        target_field:'function_name',
        match_fields:[],
        required_case_fields:[],
        description:''
    });
    _activeTemplateId=t.templateId;
    renderTemplates();
}

function deleteTemplateStage(idx){
    var t=editableTemplate();
    if(!t||!t.stages||!t.stages[idx]) return;
    if(!confirm('删除这个检查点？')) return;
    t.stages.splice(idx,1);
    normalizeTemplateStageOrder(t);
    _activeTemplateId=t.templateId;
    renderTemplates();
}

function saveTemplateDraft(){
    var t=editableTemplate();
    if(!t){toast('没有可保存的模板','err');return;}
    normalizeTemplateStageOrder(t);
    fetch(BASE+'/api/templates',{
        method:'POST',
        headers:{'Content-Type':'application/json'},
        body:JSON.stringify(t)
    }).then(function(r){return r.json();}).then(function(d){
        if(d.code!=='10000'){toast('保存失败: '+(d.message||''),'err');return;}
        _activeTemplateId=d.data.templateId||t.templateId;
        toast('模板已保存到后端','ok');
        loadTemplates();
    }).catch(function(){toast('保存模板请求失败','err');});
}

function normalizeTemplateStageOrder(t){
    (t.stages||[]).forEach(function(stage,idx,stages){
        stage.depends_on=idx>0?stages[idx-1].key:null;
    });
}

function deleteTemplateDraft(){
    var t=currentTemplate();
    if(!t) return;
    if(!confirm('删除这个模板？')) return;
    fetch(BASE+'/api/templates/'+encodeURIComponent(t.templateId),{method:'DELETE'}).then(function(r){return r.json();}).then(function(d){
        if(d.code!=='10000'){toast('删除失败: '+(d.message||''),'err');return;}
        _activeTemplateId='';
        toast('模板已删除','ok');
        loadTemplates();
    }).catch(function(){toast('删除模板请求失败','err');});
}
