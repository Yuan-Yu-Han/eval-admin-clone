/* ══════ Runs ══════ */
function _yyMM(){ var d=new Date(); return String(d.getFullYear()).slice(2)+'-'+String(d.getMonth()+1).padStart(2,'0'); }
function runSelected(){
    var ids=selIds(); if(!ids.length){toast('请先勾选用例','err');return;}
    showRunConfirm(ids,'已勾选 '+ids.length+' 个用例','选中用例评测-'+_yyMM());
}
function runAllEnabled(){
    var base=filteredCases.length?filteredCases:allCases;
    var ids=base.filter(function(c){return c.enabled;}).map(function(c){return c.id;});
    if(!ids.length){toast('筛选范围内没有已启用用例','err');return;}
    var tf=document.getElementById('case-tool-filter').value;
    var gf=_activeGroup;
    var q=document.getElementById('case-q').value.trim();
    var parts=[];
    if(gf) parts.push('分组='+gf);
    if(tf) parts.push('工具='+tf);
    if(_activeRegression==='reg') parts.push('回归=回归集');
    if(_activeRegression==='non-reg') parts.push('回归=非回归集');
    if(q) parts.push('关键词='+q);
    var hint=parts.length?'筛选条件：'+parts.join(' / '):'包含全部已启用用例';
    var name=gf?(gf+'-'+_yyMM()):('全量评测-'+_yyMM());
    showRunConfirm(ids,hint,name);
}
function openNewRunFromRuns(){
    loadVersionOptions(function(){
        var ids=allCases.filter(function(c){return c.enabled;}).slice(0,12).map(function(c){return c.id;});
        showRunConfirm(ids,'默认使用当前已启用用例','评测运行-'+_yyMM());
    });
}
function showRunConfirm(ids,hint,name){
    document.getElementById('rc-count').textContent=ids.length;
    document.getElementById('rc-hint').textContent=hint;
    document.getElementById('rc-name').value=name||'';
    loadMockConfigs();
    loadVersionOptions();
    var okBtn=document.getElementById('rc-ok');
    okBtn.onclick=function(){
        var runName=document.getElementById('rc-name').value.trim()||name;
        var concurrency=parseInt(document.getElementById('rc-concurrency').value)||1;
        var mockCfgId=document.getElementById('rc-mock-config').value;
        _curConfigId=mockCfgId||_curConfigId;
        try{ if(mockCfgId) localStorage.setItem(RUN_MOCK_CONFIG_KEY,mockCfgId); }catch(e){}
        var agentVersion=document.getElementById('rc-agent-version').value;
        closeRunConfirm();
        startRun(ids,runName,concurrency,mockCfgId,{agentVersion:agentVersion});
    };
    document.getElementById('ol-run-confirm').classList.add('open');
}
function reRun(runId){
    fetch(BASE+'/api/runs/'+runId).then(function(r){return r.json();}).then(function(d){
        if(d.code!=='10000'){toast('加载失败','err');return;}
        var r=d.data;
        if(!r||!r.caseIds||!r.caseIds.length){toast('该运行无用例信息','err');return;}
        showRunConfirm(r.caseIds,'重跑「'+esc(r.name||'')+'」('+r.caseIds.length+' 条)','重跑 '+esc(r.name||''));
    }).catch(function(){toast('请求异常','err');});
}
function deleteRun(runId){
    if(!confirm('确定删除这条运行记录吗？\n\n删除后无法恢复。')) return;
    fetch(BASE+'/api/runs/'+runId,{method:'DELETE'}).then(function(r){return r.json();}).then(function(d){
        if(d.code==='10000'){
            toast('运行记录已删除','ok');
            if(_currentRun&&_currentRun.id===runId) backToRuns();
            else loadRuns();
        }else toast('删除失败: '+(d.message||''),'err');
    }).catch(function(){toast('删除请求失败','err');});
}
function closeRunConfirm(){document.getElementById('ol-run-confirm').classList.remove('open');}
var _runSelectedCaseIds={};
function toggleRunCaseSelect(caseId,checked){
    if(checked) _runSelectedCaseIds[caseId]=true;
    else delete _runSelectedCaseIds[caseId];
}
function clearRunSelection(){
    _runSelectedCaseIds={};
    renderRD(_currentRun);
}
function applyRunSelectionToRegression(){
    if(!_currentRun){toast('请先打开运行详情','err');return;}
    var selected=Object.keys(_runSelectedCaseIds);
    if(!selected.length){toast('请先在结果中勾选用例','err');return;}
    fetch(BASE+'/api/cases/regression-by-caseids',{
        method:'POST',
        headers:{'Content-Type':'application/json'},
        body:JSON.stringify({caseIds:selected,regression:true,actor:'run-review-ui'})
    }).then(function(r){return r.json();}).then(function(d){
        if(d.code==='10000'){
            toast('已加入回归集 '+(d.data.changed||0)+' 条','ok');
            _runSelectedCaseIds={};
            loadCases();
            viewRun(_currentRun.id);
        }else toast('操作失败: '+(d.message||''),'err');
    }).catch(function(){toast('请求失败','err');});
}
function startRun(ids,name,concurrency,mockConfigId,versionOptions){
    var body={caseIds:ids,name:name,concurrency:concurrency||1,mockConfigId:mockConfigId||''};
    if(versionOptions){
        if(versionOptions.datasetVersion) body.datasetVersion=versionOptions.datasetVersion;
        if(versionOptions.agentVersion) body.agentVersion=versionOptions.agentVersion;
        if(versionOptions.testsetId) body.testsetId=versionOptions.testsetId;
    }
    fetch(BASE+'/api/runs',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)})
    .then(r=>r.json()).then(d=>{
        if(d.code==='10000'){
            toast('评测已启动 ('+ids.length+' cases)','ok');
            showLive(d.data); pollRun(d.data.id);
            go('runs');
        } else toast('启动失败: '+d.message,'err');
    }).catch(e=>toast('请求异常','err'));
}
function loadRuns(){
    fetch(BASE+'/api/runs').then(r=>r.json()).then(d=>{
        if(d.code==='10000'){ allRuns=filterItemsForActiveProject(d.data||[]); renderVersionOptions(); filterRuns();
            allRuns.filter(r=>r.status==='RUNNING').forEach(function(r){showLive(r);pollRun(r.id);});
            if(!allRuns.some(r=>r.status==='RUNNING')) hideLive();
            renderWorkspaceHome();
        }
    });
}
function filterRuns(){
    var q=document.getElementById('run-q').value.toLowerCase();
    var agent=document.getElementById('run-agent-filter').value;
    renderRuns(allRuns.filter(function(r){
        var version=(r.versionInfo&&r.versionInfo.agentVersion)||'';
        if(agent&&version!==agent) return false;
        if(q&&!((r.name||'').toLowerCase().includes(q)||(r.runId||'').toLowerCase().includes(q))) return false;
        return true;
    }));
}
function renderRuns(list){
    var tb=document.getElementById('tb-runs');
    if(!list.length){tb.innerHTML='<tr><td colspan="9" class="empty">暂无运行记录</td></tr>';return;}
    tb.innerHTML=list.map(function(r){
        var st={'PENDING':'tag-wait','RUNNING':'tag-running','COMPLETED':'tag-done','FAILED':'tag-fail','STOPPED':'tag-fail'}[r.status]||'';
        var stl={'PENDING':'等待中','RUNNING':'运行中','COMPLETED':'已完成','FAILED':'失败','STOPPED':'已停止'}[r.status]||r.status;
        var pct=r.totalCases>0?Math.round(r.completedCases/r.totalCases*100):0;
        var rate=r.totalCases>0?Math.round(r.passedCases/r.totalCases*100)+'%':'-';
        var dur=r.durationMs>0?fd(r.durationMs):(r.status==='RUNNING'?'...':'-');
        var agentVersion=(r.versionInfo&&r.versionInfo.agentVersion)||'-';
        var datasetVersion=(r.versionInfo&&r.versionInfo.datasetVersion)||'-';
        return '<tr id="rr-'+r.id+'">'+
            '<td><strong>'+esc(r.name)+'</strong><br><span class="mono" style="font-size:11px;color:var(--c-text3)">'+esc(r.runId)+'</span></td>'+
            '<td><span class="tag" style="background:var(--c-accent-light);color:var(--c-accent);font-size:11px">'+esc(agentVersion)+'</span><br><span class="mono" style="font-size:11px;color:var(--c-text3)">'+esc(datasetVersion)+'</span></td>'+
            '<td><span class="tag" style="background:var(--c-blue-bg);color:var(--c-blue);font-size:11px">'+esc(r.env||'-')+'</span></td>'+
            '<td><span class="tag '+st+'">'+stl+'</span></td>'+
            '<td><div style="display:flex;align-items:center;gap:8px"><span class="mono" style="font-size:12px">'+r.completedCases+'/'+r.totalCases+'</span>'+
                '<div class="prog" style="flex:1"><div class="prog-fill '+(r.status==='RUNNING'?'running':'ok')+'" style="width:'+pct+'%"></div></div>'+
                '<span class="mono" style="font-size:11px;color:var(--c-text3)">'+pct+'%</span></div></td>'+
            '<td>'+(r.totalCases>0?'<span style="color:'+(r.passedCases===r.totalCases?'var(--c-green)':'var(--c-amber)')+'">'+rate+'</span> <span style="font-size:11px;color:var(--c-text3)">('+r.passedCases+'/'+r.totalCases+')</span>':'-')+'</td>'+
            '<td class="mono" style="font-size:12px">'+dur+'</td>'+
            '<td style="white-space:nowrap;color:var(--c-text3)">'+ft(r.startedAt)+'</td>'+
            '<td style="white-space:nowrap">'+(r.status==='RUNNING'?'<button class="btn btn-r btn-sm" onclick="stopRun(\''+r.id+'\')">停止</button> ':
            '<button class="btn btn-flat btn-sm" onclick="reRun(\''+r.id+'\')">重跑</button> <button class="btn btn-flat btn-sm" style="color:var(--c-red)" onclick="deleteRun(\''+r.id+'\')">删除</button> ')+
            '<button class="btn btn-flat btn-sm" onclick="viewRun(\''+r.id+'\')">详情</button></td></tr>';
    }).join('');
}

/* -- Live banner -- */
function checkRunning(){
    fetch(BASE+'/api/runs').then(function(r){return r.json();}).then(function(d){
        if(d.code==='10000'){
            (d.data||[]).filter(function(r){return r.status==='RUNNING';}).forEach(function(r){showLive(r);pollRun(r.id);});
        }
    }).catch(function(){});
}
var _liveRunId=null;
function showLive(r){
    _liveRunId=r.id||_liveRunId;
    var b=document.getElementById('live-banner'); b.classList.add('show');
    var pct=r.totalCases>0?Math.round(r.completedCases/r.totalCases*100):0;
    document.getElementById('live-text').textContent='评测运行中 '+r.completedCases+'/'+r.totalCases;
    document.getElementById('live-prog').style.width=pct+'%';
}
function hideLive(){ document.getElementById('live-banner').classList.remove('show'); _liveRunId=null; }
function stopRun(id){
    if(!confirm('确定停止该评测?'))return;
    fetch(BASE+'/api/runs/'+id+'/stop',{method:'POST'}).then(function(r){return r.json();}).then(function(d){
        if(d.code==='10000'){toast('正在停止...','info');}else{toast(d.message,'err');}
    }).catch(function(){toast('请求异常','err');});
}
function stopLiveRun(){ if(_liveRunId) stopRun(_liveRunId); }

function pollRun(id){
    if(polls[id])return;
    polls[id]=setInterval(function(){
        fetch(BASE+'/api/runs/'+id+'/status').then(r=>r.json()).then(d=>{
            if(d.code==='10000'){
                var s=d.data;
                if(s.status!=='RUNNING'){
                    clearInterval(polls[id]); delete polls[id]; loadRuns();
                    if(s.status==='STOPPED'){
                        toast('评测已停止 '+s.completedCases+'/'+s.totalCases+' 已完成','info');
                    } else {
                        var ok=s.passedCases===s.totalCases;
                        toast('评测完成 '+s.passedCases+'/'+s.totalCases+' 通过', ok?'ok':'info');
                    }
                    hideLive();
                } else {
                    showLive({completedCases:s.completedCases,totalCases:s.totalCases});
                    var row=document.getElementById('rr-'+id);
                    if(row){
                        var pct=s.totalCases>0?Math.round(s.completedCases/s.totalCases*100):0;
                        row.querySelector('.prog-fill').style.width=pct+'%';
                        row.querySelector('.mono').textContent=s.completedCases+'/'+s.totalCases;
                    }
                }
            }
        });
    },3000);
}

/* ══════ Run Detail ══════ */
var _currentRun=null;
var _rdFilter='all';
var _rdTemplateFilter='';
var _runTemplateList=[];
var _rdPerfFilter={ttft:'',llm:'',tool:'',db:'',token:'',cost:''};
var _rdLlmScoreFilter={min:'',max:'69'};
var _rdReadMode=false;
var _compareMode=false,_compareBaseRun=null,_compareCaseList=[],_compareIdx=0;
var _rdCollapsedTemplateGroups={};
function uidTier(userId){
    var uid=String(userId||'').trim();
    if(!uid) return {label:'未标注用户',style:'background:#f3f4f6;color:var(--c-text2)'};
    if(/^9\d{8,}$/.test(uid)) return {label:'真实用户',style:'background:var(--c-green-bg);color:var(--c-green)'};
    if(/^seed[-_]/i.test(uid)||/^demo[-_]/i.test(uid)) return {label:'演示账号',style:'background:var(--c-blue-bg);color:var(--c-blue)'};
    return {label:'测试账号',style:'background:var(--c-amber-bg);color:var(--c-amber)'};
}
function viewRun(id){
    document.getElementById('runs-list').style.display='none';
    document.getElementById('runs-detail').style.display='block';
    document.getElementById('rd-title').textContent='加载中...';
    document.getElementById('rd-body').innerHTML='<div class="empty">加载中...</div>';
    _runSelectedCaseIds={};
    _compareBaseRun=null;
    fetch(BASE+'/api/runs/'+id).then(r=>r.json()).then(d=>{
        if(d.code==='10000'){
            _currentRun=d.data;
            _rdTemplateFilter='';
            populateBaselineSelect();
            loadRunTemplates().then(function(){
                try{
                    renderRD(d.data);
                }catch(err){
                    console.error('renderRD failed', err);
                    document.getElementById('rd-title').textContent=d.data&&d.data.name?d.data.name:'运行详情';
                    document.getElementById('rd-body').innerHTML='<div class="empty">详情渲染失败，请刷新后重试。</div>';
                    toast('详情渲染失败','err');
                }
            });
        }else{
            document.getElementById('rd-body').innerHTML='<div class="empty">加载失败：'+esc(d.message||'未知错误')+'</div>';
            toast('加载失败','err');
        }
    }).catch(function(err){
        console.error('viewRun failed', err);
        document.getElementById('rd-body').innerHTML='<div class="empty">加载失败，请检查服务是否已重启。</div>';
        toast('加载失败','err');
    });
}
function backToRuns(){
    document.getElementById('runs-detail').style.display='none';
    document.getElementById('runs-list').style.display='block';
    _currentRun=null;
    _runSelectedCaseIds={};
    _compareBaseRun=null;
    loadRuns();
}
function populateBaselineSelect(){
    var sel=document.getElementById('baseline-select');
    var cur=_currentRun?_currentRun.id:'';
    var opts='<option value="">未选择</option>';
    allRuns.filter(function(r){return r.id!==cur&&(r.status==='COMPLETED'||r.status==='STOPPED');}).forEach(function(r){
        var rate=r.totalCases>0?Math.round(r.passedCases/r.totalCases*100)+'%':'-';
        opts+='<option value="'+r.id+'">'+esc(r.name)+' ('+rate+')</option>';
    });
    sel.innerHTML=opts;
    if(_compareBaseRun) sel.value=_compareBaseRun.id||'';
}
function loadRunTemplates(){
    if(typeof allCaseTemplates==='function'){
        return allCaseTemplates().then(function(list){_runTemplateList=list||[];});
    }
    return fetch(BASE+'/api/templates').then(function(r){return r.json();}).then(function(d){
        _runTemplateList=(d.code==='10000'&&d.data&&d.data.templates)||[];
    }).catch(function(){_runTemplateList=[];});
}
function runTemplateById(templateId){
    return (_runTemplateList||[]).find(function(t){return t.templateId===templateId;})||null;
}
function isLegacyStageChain(checks){
    var keys=(checks||[]).map(function(check){return String(check&&(check.stage_key||check.stageKey||check.key||'')||'');}).filter(Boolean);
    if(!keys.length) return false;
    var legacyKeys=['intent','functionInvocation','inputConditionRetention','replyFaithfulness','responseQuality'];
    return keys.every(function(key){return legacyKeys.indexOf(key)>=0;});
}
function contractCheckForStage(result,stageKey){
    var map={
        functionInvocation:'route',
        inputConditionRetention:'input',
        agentIntermediateCall:'skillResult',
        replyFaithfulness:'render'
    };
    var contractKey=map[String(stageKey||'')];
    if(!contractKey) return null;
    return (result.contractChecks||[]).find(function(item){return item.key===contractKey;})||null;
}
function matchTemplateStageCheck(stage, checks){
    var stageKey=String(stage&&stage.key||'');
    var stageName=String(stage&&stage.name||stage&&stage.label||'');
    return (checks||[]).find(function(check){
        var key=String(check&&(check.stage_key||check.stageKey||check.key||'')||'');
        var label=String(check&&(check.stage_name||check.stageName||check.label||'')||'');
        return (stageKey&&key===stageKey)||(stageName&&label===stageName);
    })||null;
}
function normalizeStageRowFromCheck(stage, check){
    var score=isFinite(Number(check.score))?Math.round(Number(check.score)):(check.pass?100:0);
    return {
        key:(stage&&stage.key)||check.stage_key||check.stageKey||check.key||'stage',
        label:(stage&&stage.name)||(stage&&stage.label)||check.stage_name||check.stageName||check.label||check.key||'检查点',
        stageLabel:(stage&&stage.name)||(stage&&stage.label)||check.stage_name||check.stageName||check.label||check.key||'检查点',
        pass:!!check.pass,
        score:score,
        expected:check.expected||'',
        actual:check.actual||check.actualText||'',
        reason:check.reason||check.summary||check.description||''
    };
}
function stageRowFromContract(stage, contractCheck){
    if(!contractCheck) return null;
    var score=isFinite(Number(contractCheck.score))?Math.round(Number(contractCheck.score)):(contractCheck.pass?100:0);
    return {
        key:stage.key||'stage',
        label:stage.name||stage.label||stage.key||'检查点',
        stageLabel:stage.name||stage.label||stage.key||'检查点',
        pass:!!contractCheck.pass,
        score:score,
        expected:'',
        actual:'',
        reason:contractCheck.summary||contractCheck.evidence||''
    };
}
function stageRowFromLlmJudge(stage,result){
    if(!(result.llmJudge&&isFinite(Number(result.llmJudge.score)))) return null;
    var score=Math.max(0,Math.min(100,Math.round(Number(result.llmJudge.score))));
    return {
        key:stage.key||'stage',
        label:stage.name||stage.label||stage.key||'检查点',
        stageLabel:stage.name||stage.label||stage.key||'检查点',
        pass:result.llmJudge.pass!==undefined?!!result.llmJudge.pass:(score>=(Number(stage.judge_threshold)||80)),
        score:score,
        expected:'',
        actual:'',
        reason:result.llmJudge.reason||result.llmJudge.comment||''
    };
}
function resultTemplateId(result){
    var meta=result.caseMeta||{};
    return result.template_id||result.templateId||meta.template_id||meta.templateId||'__legacy__';
}
function resultTemplateName(result){
    var id=resultTemplateId(result);
    if(id==='__legacy__') return '未绑定模板';
    var t=runTemplateById(id);
    return (t&&t.name)||id;
}
function resultTemplateStageRows(result){
    var checks=result.stage_results||result.stageResults||result.stageChecks||[];
    var template=runTemplateById(resultTemplateId(result));
    var templateStages=Array.isArray(template&&template.stages)?template.stages:[];
    if(templateStages.length && (isLegacyStageChain(checks)||!checks.length)){
        return templateStages.map(function(stage){
            var direct=matchTemplateStageCheck(stage, checks);
            if(direct) return normalizeStageRowFromCheck(stage, direct);
            var contractRow=stageRowFromContract(stage, contractCheckForStage(result, stage.key));
            if(contractRow) return contractRow;
            if(String(stage.eval_type||'')==='llm_judge'){
                var llmRow=stageRowFromLlmJudge(stage,result);
                if(llmRow) return llmRow;
            }
            return {
                key:stage.key||'stage',
                label:stage.name||stage.label||stage.key||'检查点',
                stageLabel:stage.name||stage.label||stage.key||'检查点',
                pass:false,
                score:0,
                expected:'',
                actual:'',
                reason:'当前运行结果里还没有产出这个检查点的评测结果。'
            };
        });
    }
    if(checks.length){
        return checks.map(function(check){
            return normalizeStageRowFromCheck(null, check);
        });
    }
    return [];
}
function buildTemplateRunSummary(results){
    var map={};
    (results||[]).forEach(function(result){
        var id=resultTemplateId(result);
        if(!map[id]){
            map[id]={templateId:id,templateName:resultTemplateName(result),total:0,passed:0,failed:0,stages:{},results:[]};
        }
        var g=map[id];
        g.total+=1;
        if(result.pass) g.passed+=1;
        else g.failed+=1;
        g.results.push(result);
        resultTemplateStageRows(result).forEach(function(stage){
            var key=stage.key||stage.label;
            if(!g.stages[key]) g.stages[key]={key:key,label:stage.label||key,total:0,passed:0};
            g.stages[key].total+=1;
            if(stage.pass) g.stages[key].passed+=1;
        });
    });
    return Object.keys(map).map(function(key){
        var g=map[key];
        g.passRate=g.total?Math.round(g.passed*100/g.total):0;
        g.stageSummaries=Object.keys(g.stages).map(function(stageKey){
            var s=g.stages[stageKey];
            s.passRate=s.total?Math.round(s.passed*100/s.total):0;
            return s;
        });
        return g;
    }).sort(function(a,b){return b.total-a.total||a.templateName.localeCompare(b.templateName);});
}
function setRdTemplateFilter(templateId){
    _rdTemplateFilter=templateId||'';
    renderRD(_currentRun);
}
function toggleTemplateGroup(templateId){
    var collapsed=_rdCollapsedTemplateGroups[templateId]!==false;
    _rdCollapsedTemplateGroups[templateId]=!collapsed;
    renderRD(_currentRun);
}
function renderRunGlobalSummary(results,templateSummaries,run){
    var total=results.length;
    var passed=results.filter(function(r){return !!r.pass;}).length;
    var failed=total-passed;
    var rate=total?Math.round(passed*100/total):0;
    var templateCount=templateSummaries.length;
    return '<div class="run-global-summary">'+
        '<div class="run-global-card primary"><span>总体通过率</span><b style="color:'+scoreColor(rate)+'">'+rate+'%</b></div>'+
        '<div class="run-global-card"><span>Case 数</span><b>'+total+'</b></div>'+
        '<div class="run-global-card"><span>通过数</span><b style="color:var(--c-green)">'+passed+'</b></div>'+
        '<div class="run-global-card"><span>失败数</span><b style="color:var(--c-red)">'+failed+'</b></div>'+
        '<div class="run-global-card"><span>模板数</span><b>'+templateCount+'</b></div>'+
        '</div>';
}
function renderTemplateSummaryCards(templateSummaries){
    if(!templateSummaries.length) return '<div class="card" style="padding:14px;margin-bottom:16px"><div class="empty">暂无模板统计</div></div>';
    return '<div class="template-run-list">'+templateSummaries.map(function(g){
        var stageHtml=g.stageSummaries.length?g.stageSummaries.map(function(s){
            var color=s.passRate>=80?'#16a34a':(s.passRate>=60?'#d97706':'#dc2626');
            return '<div class="template-run-stage">'+
                '<div><strong>'+esc(s.label)+'</strong><span>'+s.passed+'/'+s.total+' 通过</span></div>'+
                '<b style="color:'+color+'">'+s.passRate+'%</b>'+
                '</div>';
        }).join(''):'<div class="empty" style="padding:8px">暂无检查点结果</div>';
        return '<div class="template-run-row">'+
            '<div class="template-run-head compact">'+
                '<div><h3>'+esc(g.templateName)+'</h3><p>'+g.total+' 个 Case · '+g.passed+' 通过 · '+g.failed+' 失败</p></div>'+
                '<strong style="color:'+scoreColor(g.passRate)+'">'+g.passRate+'%</strong>'+
            '</div>'+
            '<div class="template-run-stages">'+stageHtml+'</div>'+
        '</div>';
    }).join('')+'</div>';
}
function renderTemplateFilterButtons(templateSummaries){
    return '<div class="template-filter-row">'+
        '<button class="btn btn-sm '+(!_rdTemplateFilter?'btn-p':'btn-flat')+'" onclick="setRdTemplateFilter(\'\')" style="padding:2px 10px;font-size:12px">全部模板</button>'+
        templateSummaries.map(function(g){
            return '<button class="btn btn-sm '+(_rdTemplateFilter===g.templateId?'btn-p':'btn-flat')+'" onclick="setRdTemplateFilter(\''+ea(g.templateId)+'\')" style="padding:2px 10px;font-size:12px">'+esc(g.templateName)+' ('+g.total+')</button>';
        }).join('')+
        '</div>';
}
function onBaselineChanged(runId){
    if(!runId){_compareBaseRun=null;return;}
    fetch(BASE+'/api/runs/'+runId).then(function(r){return r.json();}).then(function(d){
        if(d.code==='10000'){
            _compareBaseRun=d.data;
            toast('已加载基线: '+(d.data.name||d.data.runId),'ok');
        }else{
            toast('加载基线失败','err');
            document.getElementById('baseline-select').value='';
        }
    });
}
function buildCaseDiagnosis(r){
    var rows=resultTemplateStageRows(r);
    var totalScore=caseStageScore(r,rows);
    var llmEval=(r.llmJudge&&String(r.llmJudge.reason||r.llmJudge.comment||'').trim())||'';
    if(!llmEval) llmEval='暂无 LLM 评审说明';
    var border=totalScore>=85?'#bbf7d0':(totalScore>=70?'#fde68a':'#fecaca');
    var bg=totalScore>=85?'#f0fdf4':(totalScore>=70?'#fffbeb':'#fff7f7');
    var h='<div style="border:1px solid '+border+';border-radius:8px;padding:12px 14px;margin-bottom:10px;background:'+bg+'">'+
        '<div style="display:flex;align-items:flex-start;justify-content:space-between;gap:12px;flex-wrap:wrap">'+
        '<div style="min-width:260px;flex:1">'+
        '<div style="font-size:13px;font-weight:800;color:var(--c-text)">评判得分</div>'+
        '<div style="font-size:26px;font-weight:900;line-height:1.1;margin-top:6px;color:'+scoreColor(totalScore)+'">'+totalScore+'<span style="font-size:13px;color:var(--c-text3);font-weight:700"> / 100</span></div>'+
        '</div>'+
        scoreTag(totalScore)+
        '</div>'+
        '<div style="display:grid;gap:8px;margin-top:10px">'+renderStageScoreRows(rows)+'</div>'+
        '<div style="margin-top:10px;border:1px solid #e5e7eb;border-radius:8px;background:#fff;padding:10px 12px">'+
        '<div style="font-size:11px;color:var(--c-text3);margin-bottom:6px">综合说明</div>'+
        '<div style="font-size:13px;line-height:1.6;color:var(--c-text);white-space:pre-wrap;word-break:break-word">'+esc(llmEval)+'</div>'+
        '</div>'+
        '</div>';
    return h;
}
function scoreColor(score){
    return score>=85?'var(--c-green)':(score>=70?'var(--c-amber)':'var(--c-red)');
}
function scoreTag(score){
    var label=score>=85?'优秀':(score>=70?'待优化':'风险');
    var bg=score>=85?'var(--c-green-bg)':(score>=70?'var(--c-amber-bg)':'var(--c-red-bg)');
    return '<span class="tag" style="background:'+bg+';color:'+scoreColor(score)+';font-size:12px">'+label+'</span>';
}
function caseStageScore(result,rows){
    var scored=(rows||[]).map(function(row){return Number(row.score);}).filter(function(v){return isFinite(v);});
    if(scored.length) return Math.round(scored.reduce(function(a,b){return a+b;},0)/scored.length);
    if(result.llmJudge&&isFinite(Number(result.llmJudge.score))) return Math.round(Number(result.llmJudge.score));
    return result.pass?90:55;
}
function renderStageScoreRows(rows){
    if(!rows.length) return '<div style="font-size:12px;color:var(--c-text3)">本 case 未配置 Stage 评测点。</div>';
    return rows.map(function(row){
        var pass=row.pass!==undefined?!!row.pass:(Number(row.score)>=70);
        var statusLabel=pass?'通过':'失败';
        var statusColor=pass?'var(--c-green)':'var(--c-red)';
        var actual=row.actual||'';
        var reason=row.reason||row.summary||'';
        return '<div style="display:grid;grid-template-columns:110px 80px minmax(0,1fr);gap:10px;align-items:start;border:1px solid var(--c-border);border-radius:8px;background:#fff;padding:10px 12px">'+
            '<div><strong style="font-size:13px">'+esc((row.turnIndex?('T'+row.turnIndex+' · '):'')+(row.stageLabel||row.label||'检查点'))+'</strong></div>'+
            '<div><span class="tag" style="background:'+(pass?'var(--c-green-bg)':'var(--c-red-bg)')+';color:'+statusColor+'">'+statusLabel+'</span></div>'+
            '<div style="display:grid;gap:6px">'+
            '<div style="font-size:12px;color:var(--c-text2);line-height:1.5">通过状态 <b style="color:'+statusColor+'">'+statusLabel+'</b>'+(isFinite(Number(row.score))?' · 得分 <b style="color:'+scoreColor(row.score)+'">'+row.score+'</b>':'')+'</div>'+
            (row.expected?'<div><div style="font-size:11px;color:var(--c-text3);margin-bottom:3px">期望</div><div class="mono" style="font-size:11px;color:var(--c-text2);white-space:pre-wrap;word-break:break-word">'+esc(row.expected)+'</div></div>':'')+
            (actual?'<div><div style="font-size:11px;color:var(--c-text3);margin-bottom:3px">实际</div><div class="mono" style="font-size:11px;color:var(--c-text2);white-space:pre-wrap;word-break:break-word">'+esc(actual)+'</div></div>':'')+
            ((!pass&&reason)?'<div><div style="font-size:11px;color:var(--c-text3);margin-bottom:3px">原因</div><div style="font-size:12px;color:var(--c-text2);line-height:1.5;white-space:pre-wrap;word-break:break-word">'+esc(reason)+'</div></div>':'')+
            '</div></div>';
    }).join('');
}
function finalReplyText(result){
    var turns=result.turns||[];
    for(var i=turns.length-1;i>=0;i--){
        if(turns[i].llmReplyText) return String(turns[i].llmReplyText||'');
    }
    return '';
}
function parseEvalExpectedText(value){
    if(value===undefined||value===null) return '';
    if(typeof value==='object') return expectedArgText(value);
    return String(value||'').trim();
}
function evalThreshold(value){
    var text=parseEvalExpectedText(value);
    var json=parseExpectedArg(text);
    var raw=json&&json.threshold!==undefined?json.threshold:null;
    if(raw===null){
        var m=/threshold\s*[:=]\s*([0-9.]+)/i.exec(text);
        if(m) raw=m[1];
    }
    var n=Number(raw);
    if(!isFinite(n)) n=0.7;
    return n<=1?n*100:n;
}
function setRdPerfFilter(key,value){
    if(!_rdPerfFilter) _rdPerfFilter={ttft:'',llm:'',tool:'',db:'',token:'',cost:''};
    _rdPerfFilter[key]=(value||'').trim();
    renderRD(_currentRun);
}
function clearRdPerfFilter(){
    _rdPerfFilter={ttft:'',llm:'',tool:'',db:'',token:'',cost:''};
    renderRD(_currentRun);
}
function metricPass(value,threshold){
    if(threshold===undefined||threshold===null||threshold==='') return true;
    var t=Number(threshold);
    if(!isFinite(t)) return true;
    var v=Number(value||0);
    if(!isFinite(v)) v=0;
    return v>=t;
}
function passRdPerfFilter(r){
    var m=r.metrics||{};
    var lb=m.latencyBreakdown||{};
    var tu=m.tokenUsage||{};
    return metricPass(m.firstTokenMs,_rdPerfFilter.ttft)
        && metricPass(lb.llmMs,_rdPerfFilter.llm)
        && metricPass(lb.toolMs,_rdPerfFilter.tool)
        && metricPass(lb.dbMs,_rdPerfFilter.db)
        && metricPass(tu.totalTokens,_rdPerfFilter.token)
        && metricPass(m.costUsd,_rdPerfFilter.cost);
}
function getRdLlmScore(r){
    if(!r) return null;
    if(r.llmJudge&&isFinite(Number(r.llmJudge.score))){
        return Math.max(0,Math.min(100,Math.round(Number(r.llmJudge.score))));
    }
    if(Array.isArray(r.stageChecks)){
        var q=(r.stageChecks||[]).find(function(item){return item.key==='responseQuality';});
        if(q&&isFinite(Number(q.score))) return Math.max(0,Math.min(100,Math.round(Number(q.score))));
    }
    return null;
}
function passRdLlmRange(score){
    if(score===null||score===undefined) return false;
    var minRaw=_rdLlmScoreFilter.min;
    var maxRaw=_rdLlmScoreFilter.max;
    var hasMin=minRaw!==''&&isFinite(Number(minRaw));
    var hasMax=maxRaw!==''&&isFinite(Number(maxRaw));
    var min=hasMin?Number(minRaw):0;
    var max=hasMax?Number(maxRaw):100;
    if(min>max){
        var tmp=min; min=max; max=tmp;
    }
    return score>=min&&score<=max;
}
function setRdLlmScoreFilter(key,value){
    if(!_rdLlmScoreFilter) _rdLlmScoreFilter={min:'',max:'69'};
    var v=(value||'').trim();
    if(v!==''){
        var n=Number(v);
        if(!isFinite(n)) v='';
        else v=String(Math.max(0,Math.min(100,Math.round(n))));
    }
    _rdLlmScoreFilter[key]=v;
    renderRD(_currentRun);
}
function renderRD(run){
    _debugData=[];
    document.getElementById('rd-title').textContent=run.name;
    var projectId=activeProjectId();
    var res=(run.results||[]).filter(function(result){
        if(!projectId||projectId==='all') return true;
        var meta=result.caseMeta||{};
        return !meta.projectId||meta.projectId===projectId||run.projectId===projectId;
    }), pass=res.filter(r=>r.pass).length, fail=res.length-pass;
    run=Object.assign({},run,{results:res});
    var flaggedCount=res.filter(function(r){return !!r.reviewFlagged;}).length;
    var llmRangeCount=res.filter(function(r){return passRdLlmRange(getRdLlmScore(r));}).length;
    var selectedCount=Object.keys(_runSelectedCaseIds||{}).length;
    var avgScore=res.length?Math.round(res.reduce(function(sum,item){return sum+caseStageScore(item,resultTemplateStageRows(item));},0)/res.length):0;
    var rate=res.length>0?Math.round(pass/res.length*100):0;
    var templateSummaries=buildTemplateRunSummary(res);
    var firstTokenAvg=(run.metrics&&run.metrics.firstTokenAvgMs)||0;
    var totalTokens=((run.metrics&&run.metrics.tokenUsage&&run.metrics.tokenUsage.totalTokens)||0);
    var totalCost=Number((run.metrics&&run.metrics.costUsd)||0).toFixed(4);

    var h=renderRunGlobalSummary(res,templateSummaries,run);
    h+='<div class="section"><div class="section-title">模板 Summary</div>'+renderTemplateSummaryCards(templateSummaries)+'</div>';

    h+='<div class="card" style="padding:14px;margin-bottom:16px"><div class="read-meta" style="margin-top:0;display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px 12px;font-size:12px">'+
        '<div><span style="color:var(--c-text3);margin-right:6px">runId</span><span class="mono">'+esc(run.runId||'-')+'</span></div>'+
        '<div><span style="color:var(--c-text3);margin-right:6px">环境</span>'+esc(run.env||'-')+'</div>'+
        '<div><span style="color:var(--c-text3);margin-right:6px">状态</span>'+esc(run.status||'-')+'</div>'+
        '<div><span style="color:var(--c-text3);margin-right:6px">开始时间</span>'+ft(run.startedAt)+'</div>'+
        '<div><span style="color:var(--c-text3);margin-right:6px">结束时间</span>'+ft(run.finishedAt)+'</div>'+
        '<div><span style="color:var(--c-text3);margin-right:6px">总耗时</span>'+fd(run.durationMs)+'</div>'+
        '</div></div>';

    if(run.versionInfo){
        h+='<div class="card" style="padding:14px;margin-bottom:16px">'+
            '<div style="font-size:13px;font-weight:700;margin-bottom:10px">版本定义与可复现信息</div>'+
            '<div style="display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px 12px;font-size:12px">'+
            '<div><span style="color:var(--c-text3);margin-right:6px">测试集版本</span>'+esc(run.versionInfo.datasetVersion||'-')+'</div>'+
            '<div><span style="color:var(--c-text3);margin-right:6px">Agent 版本</span>'+esc(run.versionInfo.agentVersion||'-')+'</div>'+
            '<div><span style="color:var(--c-text3);margin-right:6px">模型版本</span>'+esc(run.versionInfo.modelVersion||'-')+'</div>'+
            '<div><span style="color:var(--c-text3);margin-right:6px">RAG 版本</span>'+esc(run.versionInfo.ragVersion||'-')+'</div>'+
            '<div><span style="color:var(--c-text3);margin-right:6px">Tool 版本</span>'+esc(run.versionInfo.toolVersion||'-')+'</div>'+
            '<div><span style="color:var(--c-text3);margin-right:6px">服务 Commit</span><span class="mono">'+esc(run.versionInfo.serviceCommit||'-')+'</span></div>'+
            '</div></div>';
    }

    h+='<div class="section"><div class="section-title" style="display:flex;align-items:center;gap:12px">Case 明细'+
        '<span style="font-size:13px;font-weight:400;display:inline-flex;gap:6px;align-items:center">'+
        '<button class="btn btn-sm '+ (_rdFilter==='all'?'btn-p':'btn-flat')+'" onclick="_rdFilter=\'all\';renderRD(_currentRun)" style="padding:2px 10px;font-size:12px">全部</button>'+
        '<button class="btn btn-sm '+ (_rdFilter==='pass'?'btn-p':'btn-flat')+'" onclick="_rdFilter=\'pass\';renderRD(_currentRun)" style="padding:2px 10px;font-size:12px">达标</button>'+
        '<button class="btn btn-sm '+ (_rdFilter==='fail'?'btn-p':'btn-flat')+'" onclick="_rdFilter=\'fail\';renderRD(_currentRun)" style="padding:2px 10px;font-size:12px">未达标</button>'+
        '<button class="btn btn-sm '+ (_rdFilter==='flagged'?'btn-p':'btn-flat')+'" onclick="_rdFilter=\'flagged\';renderRD(_currentRun)" style="padding:2px 10px;font-size:12px;border-color:var(--c-amber);color:var(--c-amber)">有问题 ('+flaggedCount+')</button>'+
        '<button class="btn btn-sm '+ (_rdFilter==='llm-low'?'btn-p':'btn-flat')+'" onclick="_rdFilter=\'llm-low\';renderRD(_currentRun)" style="padding:2px 10px;font-size:12px">LLM分段 ('+llmRangeCount+')</button>'+
        '<input class="fi" style="width:76px;font-size:12px;padding:2px 6px" placeholder="LLM最小" value="'+esc(_rdLlmScoreFilter.min)+'" onchange="setRdLlmScoreFilter(\'min\',this.value)">'+
        '<input class="fi" style="width:76px;font-size:12px;padding:2px 6px" placeholder="LLM最大" value="'+esc(_rdLlmScoreFilter.max)+'" onchange="setRdLlmScoreFilter(\'max\',this.value)">'+
        '<button class="btn btn-sm '+ (_rdReadMode?'btn-p':'btn-flat')+'" onclick="_rdReadMode=!_rdReadMode;renderRD(_currentRun)" style="padding:2px 10px;font-size:12px">'+(_rdReadMode?'阅读模式中':'阅读模式')+'</button>'+
        '<span class="mono" style="margin-left:6px;color:var(--c-text3)">已勾选 '+selectedCount+' 条</span>'+
        '</span></div>';
    h+=renderTemplateFilterButtons(templateSummaries);
    h+='<div class="card" style="padding:10px 12px;margin-bottom:10px;background:#fafbfc">'+
        '<div style="display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap">'+
        '<div style="font-size:12px;color:var(--c-text2)">性能筛选（显示 >= 阈值）</div>'+
        '<button class="btn btn-flat btn-sm" onclick="clearRdPerfFilter()">清空阈值</button>'+
        '</div>'+
        '<div style="display:grid;grid-template-columns:repeat(6,minmax(120px,1fr));gap:8px;margin-top:8px">'+
        '<input class="fi" style="font-size:12px;padding:6px 8px" placeholder="首字 ms" value="'+esc(_rdPerfFilter.ttft)+'" onchange="setRdPerfFilter(\'ttft\',this.value)">'+
        '<input class="fi" style="font-size:12px;padding:6px 8px" placeholder="LLM ms" value="'+esc(_rdPerfFilter.llm)+'" onchange="setRdPerfFilter(\'llm\',this.value)">'+
        '<input class="fi" style="font-size:12px;padding:6px 8px" placeholder="Tool ms" value="'+esc(_rdPerfFilter.tool)+'" onchange="setRdPerfFilter(\'tool\',this.value)">'+
        '<input class="fi" style="font-size:12px;padding:6px 8px" placeholder="DB ms" value="'+esc(_rdPerfFilter.db)+'" onchange="setRdPerfFilter(\'db\',this.value)">'+
        '<input class="fi" style="font-size:12px;padding:6px 8px" placeholder="Token" value="'+esc(_rdPerfFilter.token)+'" onchange="setRdPerfFilter(\'token\',this.value)">'+
        '<input class="fi" style="font-size:12px;padding:6px 8px" placeholder="Cost USD" value="'+esc(_rdPerfFilter.cost)+'" onchange="setRdPerfFilter(\'cost\',this.value)">'+
        '</div></div>';
    var filtered=res.filter(function(r){
        if(_rdFilter==='pass'&&!r.pass) return false;
        if(_rdFilter==='fail'&&r.pass) return false;
        if(_rdFilter==='flagged'&&!r.reviewFlagged) return false;
        if(_rdFilter==='llm-low'&&!passRdLlmRange(getRdLlmScore(r))) return false;
        if(_rdTemplateFilter&&resultTemplateId(r)!==_rdTemplateFilter) return false;
        return passRdPerfFilter(r);
    }).sort(function(a,b){
        var ta=resultTemplateName(a), tb=resultTemplateName(b);
        if(ta!==tb) return ta.localeCompare(tb);
        return String(a.caseId||'').localeCompare(String(b.caseId||''));
    });
    var lastTemplateId=null;
    filtered.forEach(function(r,idx){
        var templateStageRowsForCase=resultTemplateStageRows(r);
        var totalCaseScore=caseStageScore(r,templateStageRowsForCase);
        var tn=(r.turns||[]).length;
        var toolInfo=r.toolMatchSummary&&r.toolMatchSummary!=='n/a'?' | tool '+r.toolMatchSummary:'';
        var seqScore=(r.toolCalls&&r.toolCalls.sequence)?r.toolCalls.sequence.score:0;
        var llmScore=(r.llmJudge&&isFinite(Number(r.llmJudge.score)))?Math.max(0,Math.min(100,Math.round(Number(r.llmJudge.score)))):null;
        if(llmScore===null&&Array.isArray(r.stageChecks)){
            var q=(r.stageChecks||[]).find(function(item){return item.key==='responseQuality';});
            if(q&&isFinite(Number(q.score))) llmScore=Math.max(0,Math.min(100,Math.round(Number(q.score))));
        }
        var llmTag='';
        if(llmScore!==null){
            var llmColor='var(--c-green)', llmBg='var(--c-green-bg)';
            if(llmScore<70){llmColor='var(--c-red)';llmBg='var(--c-red-bg)';}
            else if(llmScore<85){llmColor='var(--c-amber)';llmBg='var(--c-amber-bg)';}
            llmTag='<span class="tag" style="background:'+llmBg+';color:'+llmColor+';font-size:11px">LLM '+llmScore+'</span>';
        }
        var risk=r.riskLevel||'medium';
        var riskTag=risk==='high'?'<span class="tag" style="background:var(--c-red-bg);color:var(--c-red)">高风险</span>':(risk==='low'?'<span class="tag" style="background:var(--c-green-bg);color:var(--c-green)">低风险</span>':'<span class="tag" style="background:var(--c-amber-bg);color:var(--c-amber)">中风险</span>');
        var caseKey=ea(r.caseId);
        var selected=!!_runSelectedCaseIds[r.caseId];
        var cmts=r.comments||[];
        var tier=uidTier(r.userId);
        var headArrCls=_rdReadMode?'arr open':'arr';
        var bodyOpenCls=_rdReadMode?'rc-body open':'rc-body';
        var templateId=resultTemplateId(r);
        var templateName=resultTemplateName(r);
        if(templateId!==lastTemplateId){
            var group=templateSummaries.find(function(item){return item.templateId===templateId;})||{total:0,passed:0,failed:0,passRate:0};
            var collapsed=_rdCollapsedTemplateGroups[templateId]!==false;
            h+='<div class="run-template-group-head" onclick="toggleTemplateGroup(\''+ea(templateId)+'\')">'+
                '<div><strong><span class="group-arr'+(collapsed?'':' open')+'">&#9654;</span>'+esc(templateName)+'</strong><span>'+group.total+' 个 Case · '+group.passed+' 通过 · '+group.failed+' 失败</span></div>'+
                '<b style="color:'+scoreColor(group.passRate)+'">'+group.passRate+'%</b>'+
                '</div>';
            lastTemplateId=templateId;
        }
        if(_rdCollapsedTemplateGroups[templateId]!==false) return;

        // collapsed head
        var flagAct=r.reviewFlagged
            ?'<button class="btn btn-flat btn-sm" style="border-color:var(--c-amber);color:var(--c-amber)" onclick="toggleCaseReviewFlag(\''+run.id+'\',\''+caseKey+'\',false)">取消有问题</button>'
            :'<button class="btn btn-flat btn-sm" onclick="toggleCaseReviewFlag(\''+run.id+'\',\''+caseKey+'\',true)">标为有问题</button>';
        h+='<div class="rc-row'+(r.reviewFlagged?' rc-row-flagged':'')+'"><div class="rc-head" onclick="toggleRC(this)">'+
            '<span class="'+headArrCls+'">&#9654;</span>'+
            '<span class="tag" style="background:'+(totalCaseScore>=85?'var(--c-green-bg)':(totalCaseScore>=70?'var(--c-amber-bg)':'var(--c-red-bg)'))+';color:'+scoreColor(totalCaseScore)+';font-size:11px">得分 '+totalCaseScore+'</span>'+
            '<span class="tag" style="background:var(--c-blue-bg);color:var(--c-blue);font-size:11px">'+esc(templateName)+'</span>'+
            llmTag+
            '<label style="display:inline-flex;align-items:center;gap:4px;font-size:11px;color:var(--c-text2)" onclick="event.stopPropagation()"><input type="checkbox" '+(selected?'checked':'')+' onchange="toggleRunCaseSelect(\''+caseKey+'\',this.checked)">勾选</label>'+
            (r.reviewFlagged?'<span class="tag" style="background:var(--c-amber-bg);color:var(--c-amber);font-size:11px">待查</span>':'')+
            '<span class="rc-id" onclick="event.stopPropagation()">'+esc(r.caseId)+'</span>'+
            '<span class="tag" style="'+tier.style+';font-size:11px">'+tier.label+'</span>'+
            '<span class="rc-name">'+esc(r.caseName||'')+'</span>'+
            '<span class="rc-meta">'+tn+' 轮'+toolInfo+' | 评测点 '+templateStageRowsForCase.length+' 项 | '+fd(r.durationMs)+'</span>'+
            '<span class="rc-actions" onclick="event.stopPropagation()">'+
            riskTag+
            flagAct+
            '<button class="btn btn-flat btn-sm" onclick="openCompareModal(\''+caseKey+'\')">对比</button>'+
            '<button class="btn btn-flat btn-sm" onclick="quickCaseCmt(\''+run.id+'\',\''+caseKey+'\')">评论</button>'+
            '</span>'+
            '</div>';

        // expanded body
        h+='<div class="'+bodyOpenCls+'"><div class="turn-detail">';
        h+=buildCaseDiagnosis(r);
        if(false&&r.contractChecks&&r.contractChecks.length){
            var ccRoute=(r.contractChecks||[]).find(function(x){return x.key==='route';})||{};
            var ccInput=(r.contractChecks||[]).find(function(x){return x.key==='input';})||{};
            var ccSkill=(r.contractChecks||[]).find(function(x){return x.key==='skillResult';})||{};
            var ccRender=(r.contractChecks||[]).find(function(x){return x.key==='render';})||{};
            var caseHasSkill=(r.turns||[]).some(function(t){return !!t.skillResultJson;});
            var profile=r.traceProfile||{};
            var turns=r.turns||[];
            var finalTurn=turns.length?turns[turns.length-1]:{};
            var skillObj=parseJsonObj(finalTurn.skillResultJson)||{};
            var hintsObj=parseJsonObj(finalTurn.hintsJson)||{};
            function uniqueList(items){
                var seen={};
                return (items||[]).filter(Boolean).filter(function(it){
                    if(seen[it]) return false;
                    seen[it]=true;
                    return true;
                });
            }
            function pickPath(root,path){
                if(root===null||root===undefined) return undefined;
                var tokens=String(path||'').split('.').filter(Boolean);
                var nodes=[root];
                for(var i=0;i<tokens.length;i++){
                    var token=tokens[i];
                    var options=token.split('/').filter(Boolean);
                    if(!options.length) options=[token];
                    var next=[];
                    nodes.forEach(function(node){
                        options.forEach(function(rawKey){
                            var isArr=/\[\]$/.test(rawKey);
                            var key=isArr?rawKey.slice(0,-2):rawKey;
                            var val=(key?(node&&node[key]):node);
                            if(val===undefined||val===null) return;
                            if(isArr&&Array.isArray(val)) val.forEach(function(item){next.push(item);});
                            else if(!isArr) next.push(val);
                        });
                    });
                    nodes=next;
                    if(!nodes.length) break;
                }
                if(!nodes.length) return undefined;
                return nodes.length===1?nodes[0]:nodes;
            }
            function fieldLabel(path){
                var p=String(path||'').trim();
                if(p.indexOf('->')>0){
                    var ps=p.split('->');
                    return (ps[0]||'').trim()+' -> '+(ps[1]||'').trim();
                }
                var labels={
                    'case.turns[].expectedTool':'期望工具',
                    'run.results[].turns[].actualTool':'实际工具',
                    'data.filter.city':'城市',
                    'data.filter.queryDate':'日期',
                    'data.mode':'返回模式',
                    'resultType':'结果类型',
                    'success':'业务执行状态',
                    'llmReplyText':'最终回复',
                    'data.dataSource':'数据源'
                };
                return labels[p]||p;
            }
            function trimText(s,max){
                var txt=String(s||'');
                return txt.length>max?txt.slice(0,max)+'...':txt;
            }
            function inlineValue(v){
                if(v===undefined||v===null||v==='') return '(空)';
                if(Array.isArray(v)) return trimText(v.map(function(x){return typeof x==='object'?JSON.stringify(x):String(x);}).join(' | '),120)||'(空)';
                if(typeof v==='object') return trimText(JSON.stringify(v),120);
                return trimText(String(v),120);
            }
            function fieldValue(path){
                var p=String(path||'').trim();
                if(!p) return undefined;
                if(p.indexOf('->')>0){
                    var ps=p.split('->');
                    var left=(ps[0]||'').trim();
                    var right=(ps[1]||'').trim();
                    var leftVal=fieldValue(left);
                    var rightVal=fieldValue(right);
                    return '源: '+inlineValue(leftVal)+' | 目标: '+inlineValue(rightVal);
                }
                if(p==='llmReplyText') return finalTurn.llmReplyText||'';
                if(p.indexOf('case.')===0) return pickPath({turns:turns,expectedTrace:r.expectedTrace||{},traceProfile:profile},p.slice(5));
                if(p.indexOf('run.')===0) return pickPath({results:[r]},p.slice(4));
                if(p.indexOf('hints.')===0) return pickPath(hintsObj,p.slice(6));
                if(p.indexOf('data.')===0) return pickPath(skillObj,p);
                if(p==='success'||p==='resultType'||p==='skill') return pickPath(skillObj,p);
                return pickPath(skillObj,p);
            }
            function formatValue(v){
                if(v===undefined||v===null||v==='') return '(空)';
                if(Array.isArray(v)) return trimText(v.map(function(x){return typeof x==='object'?JSON.stringify(x):String(x);}).join(' | '),180)||'(空)';
                if(typeof v==='object') return trimText(JSON.stringify(v),180);
                return trimText(String(v),180);
            }
            function renderFields(fields){
                var list=uniqueList(fields);
                if(!list.length) return '<div style="font-size:12px;color:var(--c-text3);margin-top:6px">本环节无字段校验。</div>';
                return '<div style="margin-top:7px;border:1px solid #eef0f4;border-radius:6px;background:#fff;padding:0 10px">'+
                    list.map(function(path){
                        var val=fieldValue(path);
                        var miss=(val===undefined||val===null||val==='');
                        var isOptionalExpectedTrace=String(path||'').indexOf('case.expectedTrace.')===0;
                        var showVal=miss?(isOptionalExpectedTrace?'(未配置，可选)':'(空)'):formatValue(val);
                        return '<div style="display:grid;grid-template-columns:minmax(120px,180px) minmax(0,1fr);gap:8px;align-items:start;padding:7px 0;border-top:1px dashed #eef0f4">'+
                            '<div style="font-size:11px;color:var(--c-text3);word-break:break-word">'+esc(fieldLabel(path))+'</div>'+
                            '<div class="mono" style="font-size:11px;color:'+(miss?'var(--c-red)':'var(--c-text2)')+';white-space:pre-wrap;word-break:break-word">'+esc(showVal)+'</div>'+
                            '</div>';
                    }).join('')+
                    '</div>';
            }
            function statusFor(cc){
                if(cc.applies===false) return 'SKIP';
                return cc.pass?'PASS':'FAIL';
            }
            function flowCard(stepNo,title,status,summary,fields){
                var statusTag=status==='FAIL'
                    ?'<span class="tag" style="background:var(--c-red-bg);color:var(--c-red);border:1px solid #fecaca">FAIL</span>'
                    :(status==='PASS'
                        ?'<span class="tag" style="background:var(--c-green-bg);color:var(--c-green);border:1px solid #bbf7d0">PASS</span>'
                        :'<span class="tag" style="background:#f3f4f6;color:var(--c-text2);border:1px solid #e5e7eb">SKIP</span>');
                var body=status==='SKIP'
                    ?'<div style="font-size:12px;color:var(--c-text3);line-height:1.6;margin-top:5px">本 case 该环节未执行。</div>'
                    :renderFields(fields);
                return '<div style="display:grid;grid-template-columns:30px minmax(0,1fr) auto;gap:10px;align-items:start;border:1px solid #eef0f4;border-radius:8px;background:#fbfcff;padding:10px 12px">'+
                    '<span class="funnel-step">'+stepNo+'</span>'+
                    '<div><div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap"><span style="font-size:13px;font-weight:700;color:var(--c-text)">'+title+'</span></div>'+
                    (summary?'<div style="font-size:12px;color:var(--c-text2);line-height:1.6;margin-top:5px">'+esc(summary)+'</div>':'')+body+'</div>'+
                    statusTag+
                    '</div>';
            }
            var sRoute=statusFor(ccRoute), sInput=statusFor(ccInput), sSkill=statusFor(ccSkill), sRender=statusFor(ccRender);
            var routeSummary=ccRoute.summary||'检查 Agent 是否选中了期望的业务能力。';
            var inputSummary=ccInput.summary||'检查城市、日期等查询条件是否被正确提取。';
            var skillSummary=caseHasSkill?(ccSkill.summary||'检查业务能力返回结构化结果是否完整。'):'无 SkillResult 链路：这个 case 不需要调用后端业务能力。';
            var renderSummary=ccRender.summary||'检查最终回复是否覆盖结构化结果里的关键信息。';
            var failedStep=[
                {stepNo:1,title:'理解用户问题',status:sRoute},
                {stepNo:2,title:'提取查询条件',status:sInput},
                {stepNo:3,title:'调用业务能力',status:(caseHasSkill?sSkill:'SKIP')},
                {stepNo:4,title:'生成最终回复',status:sRender}
            ].find(function(x){return x.status==='FAIL';})||null;
            h+='<details style="border:1px solid var(--c-border);border-radius:8px;margin-bottom:10px;background:#fff;overflow:hidden">'+
                '<summary style="cursor:pointer;padding:10px 12px;font-size:13px;font-weight:800;color:var(--c-text)">链路判断</summary>'+
                '<div style="padding:0 12px 12px">'+
                '<div style="font-size:13px;font-weight:800;color:var(--c-text)">Case 执行链路</div>'+
                '<div style="display:grid;gap:8px;margin-top:10px">'+
                flowCard(1,'理解用户问题',sRoute,'',ccRoute.checkedFields)+
                flowCard(2,'提取查询条件',sInput,inputSummary,ccInput.checkedFields)+
                flowCard(3,'调用业务能力',caseHasSkill?sSkill:'SKIP',skillSummary,caseHasSkill?ccSkill.checkedFields:[])+
                flowCard(4,'生成最终回复',sRender,renderSummary,ccRender.checkedFields)+
                '</div></div></details>';
        }
        if(r.metrics){
            h+='<div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:10px">'+
                '<span class="tag" style="background:var(--c-blue-bg);color:var(--c-blue)">首字 '+(r.metrics.firstTokenMs||0)+'ms</span>'+
                '<span class="tag" style="background:#f3f4f6;color:var(--c-text2)">LLM '+((r.metrics.latencyBreakdown&&r.metrics.latencyBreakdown.llmMs)||0)+'ms</span>'+
                '<span class="tag" style="background:#f3f4f6;color:var(--c-text2)">Tool '+((r.metrics.latencyBreakdown&&r.metrics.latencyBreakdown.toolMs)||0)+'ms</span>'+
                '<span class="tag" style="background:#f3f4f6;color:var(--c-text2)">DB '+((r.metrics.latencyBreakdown&&r.metrics.latencyBreakdown.dbMs)||0)+'ms</span>'+
                '<span class="tag" style="background:#f3f4f6;color:var(--c-text2)">Token '+((r.metrics.tokenUsage&&r.metrics.tokenUsage.totalTokens)||0)+'</span>'+
                '<span class="tag" style="background:#f3f4f6;color:var(--c-text2)">$'+Number(r.metrics.costUsd||0).toFixed(4)+'</span>'+
                '</div>';
        }
        if(r.failReason) h+='<div style="color:var(--c-red);font-size:12px;margin-bottom:12px;padding:8px 12px;background:var(--c-red-bg);border-radius:6px">'+esc(r.failReason)+'</div>';

        var turns=r.turns||[];
        if(turns.length){
            function fullInputText(resultTurns){
                return resultTurns.map(function(t,i){
                    return (resultTurns.length>1?('第 '+(t.turnIndex||i+1)+' 段：'):'')+(t.userInput||'');
                }).join('\n');
            }
            function fullReplyText(resultTurns){
                var replies=resultTurns.map(function(t,i){
                    if(!t.llmReplyText) return '';
                    return (resultTurns.length>1?('第 '+(t.turnIndex||i+1)+' 段：'):'')+t.llmReplyText;
                }).filter(Boolean);
                return replies.join('\n')||finalReplyText(r);
            }
            var dbIdx=_debugData.length;
            _debugData.push({
                skill:turns.map(function(t){return t.skillResultJson||'';}).filter(Boolean).join('\n\n'),
                hints:turns.map(function(t){return t.hintsJson||'';}).filter(Boolean).join('\n\n'),
                label:(r.caseName||r.caseId||'Case')+' 调试信息'
            });
            h+='<details open style="border:1px solid var(--c-border);border-radius:8px;margin-bottom:10px;background:#fff;overflow:hidden">'+
                '<summary style="cursor:pointer;padding:10px 12px;font-size:13px;font-weight:800;color:var(--c-text)">评测明细 <span class="tag" style="background:#f3f4f6;color:var(--c-text2);margin-left:6px">'+turns.length+' 段输入</span></summary>'+
                '<div style="padding:12px;display:grid;gap:10px">'+
                '<div style="display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:10px">'+
                '<div><div style="font-size:11px;color:var(--c-text3);margin-bottom:5px">用户输入</div><div class="td-text" style="white-space:pre-wrap;max-height:160px">'+esc(fullInputText(turns))+'</div></div>'+
                '<div><div style="font-size:11px;color:var(--c-text3);margin-bottom:5px">模型输出</div><div class="td-text" style="white-space:pre-wrap;max-height:160px">'+esc(fullReplyText(turns))+'</div></div>'+
                '</div>'+
                '<div><div style="font-size:11px;color:var(--c-text3);margin-bottom:6px">stage_results</div>'+renderStageScoreRows(templateStageRowsForCase)+'</div>'+
                '<div style="display:flex;gap:8px;flex-wrap:wrap">'+
                (_debugData[dbIdx].skill?'<button class="btn btn-flat btn-sm" onclick="openDebugModal(_debugData['+dbIdx+'].skill,_debugData['+dbIdx+'].hints,_debugData['+dbIdx+'].label)">查看 SkillResult / Hints</button>':'')+
                '</div>'+
                '</div></details>';
        } else {
            h+='<div class="empty">无轮次数据</div>';
        }

        h+='<div style="margin-top:16px;border-top:1px solid var(--c-border);padding-top:12px">';
        h+='<div style="font-size:12px;font-weight:600;color:var(--c-text2);margin-bottom:8px">评论 ('+cmts.length+')</div>';
        cmts.forEach(function(c){
            h+='<div class="cmt" id="cmt-'+c.id+'">'+
                '<div style="display:flex;justify-content:space-between;align-items:center">'+
                '<span class="cm">'+ft(c.createdAt)+'</span>'+
                '<span>'+
                '<button class="btn btn-ghost btn-sm" onclick="editCmt(\''+run.id+'\',\''+caseKey+'\',\''+c.id+'\')">编辑</button>'+
                '<button class="btn btn-ghost btn-sm" style="color:var(--c-red)" onclick="delCmt(\''+run.id+'\',\''+caseKey+'\',\''+c.id+'\')">删除</button>'+
                '</span></div>'+
                '<div class="cmt-content" id="cc-'+c.id+'">'+esc(c.content)+'</div></div>';
        });
        h+='<div class="cmt-form"><input class="fi cmt-input" id="ci-'+caseKey+'" placeholder="添加评论... (Enter 发送)" onkeydown="if(event.key===\'Enter\'){event.preventDefault();addCaseCmt(\''+run.id+'\',\''+caseKey+'\');}">'+
            '<button class="btn btn-p btn-sm" onclick="addCaseCmt(\''+run.id+'\',\''+caseKey+'\')">发送</button></div>';
        h+='</div>';

        h+='</div></div></div>';
    });
    if(!filtered.length && res.length){
        h+='<div class="empty" style="padding:20px;text-align:center;color:var(--c-text3)">当前筛选下没有匹配的用例。</div>';
    }
    h+='</div>';

    document.getElementById('rd-body').innerHTML=h;
}
function renderOriginalRunResultTable(run){
    var res=run.results||[];
    function pickDefined(obj, keys){
        if(!obj) return undefined;
        for(var i=0;i<keys.length;i++){
            var k=keys[i];
            if(obj[k]!==undefined&&obj[k]!==null) return obj[k];
        }
        return undefined;
    }
    function passStateTag(v){
        if(v===undefined||v===null||v==='') return '<span class="tag tag-off">-</span>';
        if(typeof v==='string'){
            var s=v.trim().toLowerCase();
            if(!s) return '<span class="tag tag-off">-</span>';
            if(s==='pass'||s==='ok'||s==='true'||s==='1') return '<span class="tag tag-done">PASS</span>';
            if(s==='fail'||s==='miss'||s==='false'||s==='0') return '<span class="tag tag-fail">FAIL</span>';
            return '<span class="tag" style="background:#f3f4f6;color:var(--c-text2)">'+esc(v)+'</span>';
        }
        if(v===true||v===1) return '<span class="tag tag-done">PASS</span>';
        if(v===false||v===0) return '<span class="tag tag-fail">FAIL</span>';
        return '<span class="tag" style="background:#f3f4f6;color:var(--c-text2)">'+esc(String(v))+'</span>';
    }
    function llmJudgeCell(turn,result){
        var score=pickDefined(turn,['judgeScore','llmJudgeScore','judge_score']);
        if(score===undefined||score===null||score==='') score=result&&result.llmJudge?result.llmJudge.score:undefined;
        if(score===undefined||score===null||score==='') return '<span class="tag tag-off">-</span>';
        var n=Number(score);
        if(!isFinite(n)) return '<span class="tag" style="background:#f3f4f6;color:var(--c-text2)">'+esc(String(score))+'</span>';
        var pct=n<=1?Math.round(n*100):Math.round(n);
        var c='var(--c-green)',bg='var(--c-green-bg)';
        if(pct<70){c='var(--c-red)';bg='var(--c-red-bg)';}
        else if(pct<85){c='var(--c-amber)';bg='var(--c-amber-bg)';}
        return '<span class="tag" style="background:'+bg+';color:'+c+'">'+pct+'</span>';
    }
    function rowTurnPassTag(turn){
        var turnPass=pickDefined(turn,['turnPass','pass','turnResult','turnStatus']);
        if(turnPass!==undefined&&turnPass!==null&&turnPass!=='') return passStateTag(turnPass);
        var dimPassValues=[];
        var toolState=pickDefined(turn,['toolMatchPass','toolAssertPass','toolOk','toolMatchOk']);
        var argsState=pickDefined(turn,['argsAssertPass','argsOk','paramAssertPass','paramsAssertPass']);
        var replyState=pickDefined(turn,['replyAssertPass','replyOk','responseAssertPass']);
        var judgeState=pickDefined(turn,['judgePass','llmJudgePass','judgeOk']);
        [toolState,argsState,replyState,judgeState].forEach(function(v){
            if(v===undefined||v===null||v==='') return;
            if(typeof v==='string'){
                var s=v.trim().toLowerCase();
                if(s==='pass'||s==='ok'||s==='true'||s==='1') dimPassValues.push(true);
                else if(s==='fail'||s==='miss'||s==='false'||s==='0') dimPassValues.push(false);
            }else if(v===true||v===1) dimPassValues.push(true);
            else if(v===false||v===0) dimPassValues.push(false);
        });
        if(!dimPassValues.length) return '<span class="tag tag-off">-</span>';
        return dimPassValues.every(function(v){return v;})?'<span class="tag tag-done">PASS</span>':'<span class="tag tag-fail">FAIL</span>';
    }
    var rows=[];
    res.forEach(function(r){
        var turns=r.turns&&r.turns.length?r.turns:[{}];
        turns.forEach(function(t){
            rows.push({r:r,t:t});
        });
    });
    if(!rows.length) return '';
    var h='<div class="card" style="margin-bottom:16px">'+
        '<div style="padding:12px 14px;border-bottom:1px solid var(--c-border);display:flex;align-items:center;justify-content:space-between;gap:10px">'+
        '<div><strong style="font-size:13px">原始结果表</strong><div style="font-size:12px;color:var(--c-text3);margin-top:3px">按原页面字段优先展示，下面仍可展开看诊断和 JSON。</div></div>'+
        '<span class="tag tag-off">'+rows.length+' rows</span></div>'+
        '<div class="tbl-wrap"><table style="min-width:1180px"><thead><tr>'+
        '<th>caseId</th><th>caseName</th><th>case</th><th>turn</th><th>userInput</th><th>expectedTool</th><th>actualTool</th><th>工具匹配</th><th>参数断言</th><th>回复断言</th><th>LLM评判</th><th>Turn结论</th><th>failReason</th>'+
        '</tr></thead><tbody>';
    rows.forEach(function(row){
        var r=row.r,t=row.t||{};
        var toolState=pickDefined(t,['toolMatchPass','toolAssertPass','toolOk','toolMatchOk']);
        var argsState=pickDefined(t,['argsAssertPass','argsOk','paramAssertPass','paramsAssertPass']);
        var replyState=pickDefined(t,['replyAssertPass','replyOk','replyAssertOk','responseAssertPass']);
        h+='<tr>'+
            '<td class="mono">'+esc(r.caseId||'')+'</td>'+
            '<td>'+esc(r.caseName||'')+'</td>'+
            '<td>'+(r.pass?'<span class="tag tag-done">PASS</span>':'<span class="tag tag-fail">FAIL</span>')+'</td>'+
            '<td class="mono">'+esc(t.turnIndex||'')+'</td>'+
            '<td><div class="td-text" style="max-width:260px">'+esc(t.userInput||'')+'</div></td>'+
            '<td class="mono">'+esc(t.expectedTool||'')+'</td>'+
            '<td class="mono">'+esc(t.actualTool||'')+'</td>'+
            '<td>'+passStateTag(toolState)+'</td>'+
            '<td>'+passStateTag(argsState)+'</td>'+
            '<td>'+passStateTag(replyState)+'</td>'+
            '<td>'+llmJudgeCell(t,r)+'</td>'+
            '<td>'+rowTurnPassTag(t)+'</td>'+
            '<td><div class="td-text" style="max-width:240px">'+esc(r.failReason||'')+'</div></td>'+
            '</tr>';
    });
    h+='</tbody></table></div></div>';
    return h;
}
function toggleCaseReviewFlag(runId, caseId, flagged){
    fetch(BASE+'/api/runs/'+runId+'/cases/'+encodeURIComponent(caseId)+'/review-flag',{
        method:'PATCH',
        headers:{'Content-Type':'application/json'},
        body:JSON.stringify({flagged:!!flagged})
    }).then(function(r){return r.json();}).then(function(d){
        if(d.code==='10000'){
            _currentRun=d.data;
            renderRD(_currentRun);
            toast(flagged?'已标为有问题':'已取消标记','ok');
            if(_compareMode){
                // 同步更新导航列表中的结果引用
                var res=_currentRun.results||[];
                var cIdx=_compareIdx;
                var oldCaseId=_compareCaseList[cIdx]?_compareCaseList[cIdx].caseId:null;
                _compareCaseList=res.filter(function(r){
                    if(_rdFilter==='pass') return r.pass;
                    if(_rdFilter==='fail') return !r.pass;
                    if(_rdFilter==='flagged') return !!r.reviewFlagged;
                    if(_rdFilter==='llm-low') return !!(r.llmJudge&&r.llmJudge.score<70);
                    return true;
                });
                if(oldCaseId){
                    for(var i=0;i<_compareCaseList.length;i++){
                        if(_compareCaseList[i].caseId===oldCaseId){_compareIdx=i;break;}
                    }
                }
                renderCompareNav();
            }
        } else toast(d.message||'操作失败','err');
    }).catch(function(){toast('请求失败','err');});
}
function quickCaseCmt(runId,caseId){
    var text=prompt('请输入评论内容');
    if(text===null) return;
    text=(text||'').trim();
    if(!text){toast('评论不能为空','err');return;}
    fetch(BASE+'/api/runs/'+runId+'/cases/'+encodeURIComponent(caseId)+'/comments',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({content:text})})
        .then(function(r){return r.json();})
        .then(function(d){if(d.code==='10000'){toast('已添加','ok');viewRun(runId);}else toast('评论失败: '+(d.message||''),'err');})
        .catch(function(){toast('评论请求失败','err');});
}
var _readCmtFloatRunId='';
var _readCmtFloatCaseKey='';
var _readCmtFloatIdx=-1;

function positionReadCmtFloat(btn){
    var el=document.getElementById('read-cmt-float');
    if(!btn||!el) return;
    var r=btn.getBoundingClientRect();
    var w=Math.min(360, window.innerWidth-24);
    var left=r.right-w;
    if(left<12) left=12;
    if(left+w>window.innerWidth-12) left=window.innerWidth-12-w;
    var top=r.bottom+8;
    var estH=240;
    if(top+estH>window.innerHeight-12) top=Math.max(12, r.top-estH-8);
    el.style.left=left+'px';
    el.style.top=top+'px';
    el.style.width=w+'px';
}

/** 阅读模式：浮层评论，靠按钮定位 */
function toggleReadCmt(ev, runId, caseKey, idx){
    var btn=ev&&ev.currentTarget?ev.currentTarget:document.getElementById('read-cmt-btn-'+idx);
    var panel=document.getElementById('read-cmt-float');
    var backdrop=document.getElementById('read-cmt-float-backdrop');
    if(!btn||!panel||!backdrop) return;
    if(_readCmtFloatIdx===idx&&panel.style.display==='block'){
        closeReadCmtFloat();
        return;
    }
    _readCmtFloatRunId=runId;
    _readCmtFloatCaseKey=caseKey;
    _readCmtFloatIdx=idx;
    document.querySelectorAll('.read-cmt-toggle').forEach(function(b){ b.classList.remove('btn-p'); });
    btn.classList.add('btn-p');
    positionReadCmtFloat(btn);
    backdrop.style.display='block';
    panel.style.display='block';
    var ta=document.getElementById('read-cmt-float-ta');
    if(ta){ ta.value=''; ta.focus(); }
}

function closeReadCmtFloat(){
    var panel=document.getElementById('read-cmt-float');
    var backdrop=document.getElementById('read-cmt-float-backdrop');
    if(panel) panel.style.display='none';
    if(backdrop) backdrop.style.display='none';
    document.querySelectorAll('.read-cmt-toggle').forEach(function(b){ b.classList.remove('btn-p'); });
    _readCmtFloatIdx=-1;
    var ta=document.getElementById('read-cmt-float-ta');
    if(ta) ta.value='';
}

function submitReadCmtFloat(){
    var ta=document.getElementById('read-cmt-float-ta');
    var c=ta?ta.value.trim():'';
    if(!c){toast('评论不能为空','err');return;}
    var runId=_readCmtFloatRunId;
    var caseId=_readCmtFloatCaseKey;
    fetch(BASE+'/api/runs/'+runId+'/cases/'+encodeURIComponent(caseId)+'/comments',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({content:c})})
        .then(function(r){return r.json();})
        .then(function(d){
            if(d.code==='10000'){toast('已添加','ok');closeReadCmtFloat();viewRun(runId);}
            else toast('评论失败: '+(d.message||''),'err');
        })
        .catch(function(){toast('评论请求失败','err');});
}
function toggleDebug(id, btn){
    var el=document.getElementById(id);
    if(!el) return;
    var open=!el.classList.contains('open');
    el.classList.toggle('open', open);
    if(btn) btn.textContent=open?'收起调试信息':'展开调试信息';
}
function openDebugModal(skillJson, hintsJson, turnLabel){
    var body=document.getElementById('debug-modal-body');
    var title=document.getElementById('debug-modal-title');
    var skillStd=formatStandardSkillResult(skillJson);
    title.textContent=turnLabel?'调试信息 - '+turnLabel:'调试信息';
    var h='';
    h+='<div class="debug-section"><div class="debug-section-title">SkillResult（标准对象）</div>';
    h+='<pre>'+esc(skillStd||'(空)')+'</pre></div>';
    h+='<div class="debug-section"><div class="debug-section-title">SkillResult</div>';
    h+='<pre>'+esc(fmtJson(skillJson||'(空)'))+'</pre></div>';
    h+='<div class="debug-section"><div class="debug-section-title">Hints</div>';
    h+='<pre>'+esc(fmtJson(hintsJson||'(空)'))+'</pre></div>';
    body.innerHTML=h;
    document.getElementById('debug-overlay').classList.add('open');
}
function closeDebugModal(){
    document.getElementById('debug-overlay').classList.remove('open');
}
function openCompareModal(caseId){
    var cur=(_currentRun.results||[]).find(function(r){return r.caseId===caseId;});
    if(!cur)return;
    if(_compareBaseRun){
        initCompareNav(caseId);
        return;
    }
    showBaselinePicker(caseId);
}
function showBaselinePicker(caseId,mode){
    document.getElementById('compare-dialog').style.cssText='max-width:620px;width:90%;max-height:70vh';
    var cur=caseId?(_currentRun.results||[]).find(function(r){return r.caseId===caseId;}):null;
    var title=caseId?'选择对比 Run: '+caseId+(cur&&cur.caseName?' - '+cur.caseName:''):'选择基线 Run';
    document.getElementById('compare-modal-title').textContent=title;
    var candidates=allRuns.filter(function(r){
        return r.id!==_currentRun.id&&(r.status==='COMPLETED'||r.status==='STOPPED');
    });
    var h='';
    if(!candidates.length){
        h='<div class="empty">无其他已完成的评测运行</div>';
    }else{
        candidates.forEach(function(r){
            var rate=r.totalCases>0?Math.round(r.passedCases/r.totalCases*100)+'%':'-';
            var onclick;
            if(mode==='nav') onclick='loadBaselineAndNav(\''+r.id+'\')';
            else if(caseId) onclick='loadCompareRun(\''+r.id+'\',\''+ea(caseId)+'\')';
            else onclick='loadBaselineAndClose(\''+r.id+'\')';
            h+='<div class="run-pick-row" onclick="'+onclick+'">'+
                '<strong>'+esc(r.name)+'</strong>'+
                '<span class="mono" style="font-size:11px;color:var(--c-text3)">'+esc(r.runId)+'</span>'+
                '<span style="font-size:12px">'+ft(r.startedAt)+'</span>'+
                '<span style="font-size:12px;color:var(--c-text3)">通过率 '+rate+'</span>'+
                '</div>';
        });
    }
    document.getElementById('compare-modal-body').innerHTML=h;
    document.getElementById('compare-overlay').classList.add('open');
}
function loadCompareRun(runId,caseId){
    document.getElementById('compare-modal-body').innerHTML='<div class="empty">加载中...</div>';
    fetch(BASE+'/api/runs/'+runId).then(function(r){return r.json();}).then(function(d){
        if(d.code!=='10000'){toast('加载失败','err');return;}
        _compareBaseRun=d.data;
        document.getElementById('baseline-select').value=runId;
        initCompareNav(caseId);
    });
}
function loadBaselineAndClose(runId){
    document.getElementById('compare-modal-body').innerHTML='<div class="empty">加载中...</div>';
    fetch(BASE+'/api/runs/'+runId).then(function(r){return r.json();}).then(function(d){
        if(d.code!=='10000'){toast('加载失败','err');return;}
        _compareBaseRun=d.data;
        document.getElementById('baseline-select').value=runId;
        closeCompareModal();
        toast('已加载基线: '+(d.data.name||d.data.runId),'ok');
    });
}
function loadBaselineAndNav(runId){
    document.getElementById('compare-modal-body').innerHTML='<div class="empty">加载中...</div>';
    fetch(BASE+'/api/runs/'+runId).then(function(r){return r.json();}).then(function(d){
        if(d.code!=='10000'){toast('加载失败','err');return;}
        _compareBaseRun=d.data;
        document.getElementById('baseline-select').value=runId;
        initCompareNav();
    });
}
var _compareJsons=[];
function buildTurnsCompareHtml(cur,base){
    var h='';
    var curTurns=cur.turns||[],baseByIdx={};
    if(base)(base.turns||[]).forEach(function(t){baseByIdx[t.turnIndex]=t;});
    curTurns.forEach(function(ct,ti){
        var bt=baseByIdx[ct.turnIndex];
        var curJson=fmtJson(ct.skillResultJson||'');
        var baseJson=bt?fmtJson(bt.skillResultJson||''):'';
        var jIdx=_compareJsons.length;
        _compareJsons.push({cur:curJson,base:baseJson});

        h+='<div style="margin-bottom:24px;border:1px solid var(--c-border);border-radius:10px;padding:16px 20px">';
        h+='<div style="font-size:13px;font-weight:700;margin-bottom:14px;padding-bottom:8px;border-bottom:1px solid var(--c-border)">第 '+(ct.turnIndex||'-')+' 轮 | '+esc(ct.actualTool||'-');
        if(bt&&bt.actualTool!==ct.actualTool)h+=' <span style="color:var(--c-red);font-weight:400;font-size:12px">(基线: '+esc(bt.actualTool||'-')+')</span>';
        h+='</div>';

        // 用户输入
        h+='<div style="font-size:13px;font-weight:600;color:var(--c-text);margin-bottom:6px">用户输入</div>';
        h+='<div style="font-size:13px;line-height:1.6;background:#f0f4ff;padding:10px 14px;border-radius:8px;border:1px solid #d0d8e8;margin-bottom:16px;white-space:pre-wrap;word-break:break-word">'+esc(ct.userInput||'(空)')+'</div>';

        h+='<div style="font-size:13px;font-weight:600;color:var(--c-text);margin-bottom:8px">LLM 回复</div>';
        h+='<div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:20px">';
        h+='<div style="min-width:0"><div style="font-size:12px;font-weight:600;color:var(--c-text3);margin-bottom:6px">当前</div>'+
            '<div style="font-size:14px;line-height:1.7;background:#f9fafb;padding:14px 16px;border-radius:8px;border:1px solid var(--c-border);max-height:50vh;overflow-y:auto;white-space:pre-wrap;word-break:break-word">'+esc(ct.llmReplyText||'(空)')+'</div></div>';
        h+='<div style="min-width:0"><div style="font-size:12px;font-weight:600;color:var(--c-text3);margin-bottom:6px">基线</div>'+
            '<div style="font-size:14px;line-height:1.7;background:#f9fafb;padding:14px 16px;border-radius:8px;border:1px solid var(--c-border);max-height:50vh;overflow-y:auto;white-space:pre-wrap;word-break:break-word">'+esc(bt?bt.llmReplyText||'(空)':'')+(bt?'':'<span style="color:var(--c-text3)">基线无此用例</span>')+'</div></div>';
        h+='</div>';

        var srId='sr-'+ti;
        h+='<div style="display:flex;align-items:center;gap:8px;margin-bottom:8px">'+
            '<span style="font-size:13px;font-weight:600;color:var(--c-text)">SkillResult</span>'+
            (bt&&curJson!==baseJson?'<button class="btn btn-ghost btn-sm" id="'+srId+'-btn" onclick="toggleSrView(\''+srId+'\')" style="font-size:11px;padding:2px 8px">左右对比</button>':'')+
            '<button class="btn btn-ghost btn-sm" onclick="copyCompareJson('+jIdx+',\'cur\')" style="font-size:11px;padding:2px 8px">复制当前</button>'+
            (bt?'<button class="btn btn-ghost btn-sm" onclick="copyCompareJson('+jIdx+',\'base\')" style="font-size:11px;padding:2px 8px">复制基线</button>':'')+
            '</div>';
        var preS='white-space:pre-wrap;word-break:break-word;font-size:12px;padding:12px 16px;border-radius:8px;border:1px solid var(--c-border);max-height:50vh;overflow-y:auto;line-height:1.5';
        if(bt&&curJson!==baseJson){
            h+='<div id="'+srId+'-diff"><pre style="'+preS+';background:#fafafa">'+simpleDiff(baseJson,curJson)+'</pre></div>';
            h+='<div id="'+srId+'-side" style="display:none;grid-template-columns:1fr 1fr;gap:16px">';
            h+='<div style="min-width:0"><div style="font-size:12px;font-weight:600;color:var(--c-text3);margin-bottom:6px">当前</div><pre style="'+preS+';background:#f5f6fa">'+esc(curJson)+'</pre></div>';
            h+='<div style="min-width:0"><div style="font-size:12px;font-weight:600;color:var(--c-text3);margin-bottom:6px">基线</div><pre style="'+preS+';background:#f5f6fa">'+esc(baseJson)+'</pre></div>';
            h+='</div>';
        }else if(bt){
            h+='<div style="font-size:12px;color:var(--c-text3);padding:8px 0">无差异</div>';
        }else{
            h+='<div style="display:grid;grid-template-columns:1fr 1fr;gap:16px">';
            h+='<div style="min-width:0"><div style="font-size:12px;font-weight:600;color:var(--c-text3);margin-bottom:6px">当前</div><pre style="'+preS+';background:#f5f6fa">'+esc(curJson||'(空)')+'</pre></div>';
            h+='<div style="min-width:0"><div style="font-size:12px;font-weight:600;color:var(--c-text3);margin-bottom:6px">基线</div><div style="'+preS+';background:#f9fafb;color:var(--c-text3)">基线无此用例</div></div>';
            h+='</div>';
        }

        // HintsInfo
        var curHints=fmtJson(ct.hintsJson||'');
        var baseHints=bt?fmtJson(bt.hintsJson||''):'';
        if(curHints||baseHints){
            h+='<div style="font-size:13px;font-weight:600;color:var(--c-text);margin-top:16px;margin-bottom:8px">HintsInfo</div>';
            if(bt&&curHints!==baseHints){
                h+='<pre style="'+preS+';background:#fafafa">'+simpleDiff(baseHints,curHints)+'</pre>';
            }else if(bt&&curHints===baseHints){
                h+='<div style="font-size:12px;color:var(--c-text3);padding:8px 0">无差异</div>';
            }else{
                h+='<div style="display:grid;grid-template-columns:1fr 1fr;gap:16px">';
                h+='<div style="min-width:0"><div style="font-size:12px;font-weight:600;color:var(--c-text3);margin-bottom:6px">当前</div><pre style="'+preS+';background:#f5f6fa">'+esc(curHints||'(空)')+'</pre></div>';
                h+='<div style="min-width:0"><div style="font-size:12px;font-weight:600;color:var(--c-text3);margin-bottom:6px">基线</div><div style="'+preS+';background:#f9fafb;color:var(--c-text3)">基线无此用例</div></div>';
                h+='</div>';
            }
        }

        h+='</div>';
    });
    return h;
}
function copyCompareJson(idx,which){
    var txt=which==='cur'?_compareJsons[idx].cur:_compareJsons[idx].base;
    navigator.clipboard.writeText(txt).then(function(){toast('已复制','ok');}).catch(function(){toast('复制失败','err');});
}
function toggleSrView(id){
    var d=document.getElementById(id+'-diff'),s=document.getElementById(id+'-side'),b=document.getElementById(id+'-btn');
    if(d.style.display==='none'){d.style.display='';s.style.display='none';b.textContent='左右对比';}
    else{d.style.display='none';s.style.display='grid';b.textContent='Diff 视图';}
}
function closeCompareModal(){
    document.getElementById('compare-overlay').classList.remove('open');
}
/* ══════ 对比模式 ══════ */
function enterCompareMode(){
    if(_compareBaseRun){
        initCompareNav();
        return;
    }
    showBaselinePicker(null,'nav');
}
function initCompareNav(startCaseId){
    var res=_currentRun.results||[];
    _compareCaseList=res.filter(function(r){
        if(_rdFilter==='pass') return r.pass;
        if(_rdFilter==='fail') return !r.pass;
        if(_rdFilter==='flagged') return !!r.reviewFlagged;
        if(_rdFilter==='llm-low') return !!(r.llmJudge&&r.llmJudge.score<70);
        return true;
    });
    _compareMode=true;
    _compareIdx=0;
    if(startCaseId){
        for(var i=0;i<_compareCaseList.length;i++){
            if(_compareCaseList[i].caseId===startCaseId){_compareIdx=i;break;}
        }
    }
    document.getElementById('compare-overlay').classList.add('open');
    renderCompareNav();
}
function renderCompareNav(){
    _compareJsons=[];
    document.getElementById('compare-dialog').style.cssText='max-width:95vw;width:96%;max-height:92vh';
    var cur=_compareCaseList[_compareIdx];
    var caseId=cur.caseId;
    var total=_compareCaseList.length;
    document.getElementById('compare-modal-title').textContent='对比模式 (基线: '+(_compareBaseRun.name||_compareBaseRun.runId)+')';

    var h='<div class="cmp-nav">'+
        '<button class="btn btn-flat btn-sm" onclick="navigateCompare(-1)"'+(_compareIdx<=0?' disabled':'')+' style="min-width:80px">&larr; 上一个</button>'+
        '<div class="cmp-pos">'+esc(caseId)+(cur.caseName?' <span style="font-weight:400;font-size:13px">'+esc(cur.caseName)+'</span>':'')+' <span style="font-weight:400;color:var(--c-text3);font-size:13px">('+(_compareIdx+1)+'/'+total+')</span></div>'+
        '<button class="btn btn-flat btn-sm" onclick="navigateCompare(1)"'+(_compareIdx>=total-1?' disabled':'')+' style="min-width:80px">下一个 &rarr;</button>'+
        '<button class="btn btn-ghost btn-sm" onclick="exitCompareMode()" style="margin-left:8px">退出</button>'+
        '</div>';

    var base=(_compareBaseRun.results||[]).find(function(r){return r.caseId===caseId;});
    var flagged=!!cur.reviewFlagged;
    h+='<div style="display:flex;gap:16px;margin-bottom:16px;font-size:13px;align-items:center">'+
        '<div>当前 <span class="tag '+(cur.pass?'tag-done':'tag-fail')+'">'+(cur.pass?'PASS':'FAIL')+'</span></div>'+
        (flagged?'<span class="tag" style="background:var(--c-amber-bg);color:var(--c-amber);border:1px solid var(--c-amber)">待查</span>':'')+
        '<div>基线 '+(base?'<span class="tag '+(base.pass?'tag-done':'tag-fail')+'">'+(base.pass?'PASS':'FAIL')+'</span>':'<span style="color:var(--c-text3)">(无此用例)</span>')+'</div>'+
        '<div style="margin-left:auto;display:flex;gap:6px">'+
        '<button class="btn btn-ghost btn-sm" onclick="toggleFlagInNav()" style="'+(flagged?'border-color:var(--c-amber);color:var(--c-amber)':'')+'">'+(flagged?'取消有问题 (F)':'标为有问题 (F)')+'</button>'+
        '<button class="btn btn-ghost btn-sm" onclick="switchBaselineInNav()">换基线</button>'+
        '</div></div>';
    h+=buildTurnsCompareHtml(cur,base);
    document.getElementById('compare-modal-body').innerHTML=h;
}
function navigateCompare(delta){
    var next=_compareIdx+delta;
    if(next<0||next>=_compareCaseList.length)return;
    _compareIdx=next;
    renderCompareNav();
    document.getElementById('compare-modal-body').scrollTop=0;
}
function switchBaselineInNav(){
    // 在对比模式中切换基线：展示 run 列表，选中后重载基线并刷新当前 case
    document.getElementById('compare-dialog').style.cssText='max-width:620px;width:90%;max-height:70vh';
    document.getElementById('compare-modal-title').textContent='切换基线 Run';
    var candidates=allRuns.filter(function(r){
        return r.id!==_currentRun.id&&(r.status==='COMPLETED'||r.status==='STOPPED');
    });
    var h='';
    candidates.forEach(function(r){
        var rate=r.totalCases>0?Math.round(r.passedCases/r.totalCases*100)+'%':'-';
        var isCur=_compareBaseRun&&r.id===_compareBaseRun.id;
        h+='<div class="run-pick-row" onclick="reloadBaselineInNav(\''+r.id+'\')" style="'+(isCur?'border-color:var(--c-primary);background:var(--c-hover)':'')+'">';
        h+='<strong>'+esc(r.name)+'</strong>';
        if(isCur)h+=' <span style="font-size:11px;color:var(--c-primary)">当前</span>';
        h+='<span class="mono" style="font-size:11px;color:var(--c-text3)">'+esc(r.runId)+'</span>';
        h+='<span style="font-size:12px">'+ft(r.startedAt)+'</span>';
        h+='<span style="font-size:12px;color:var(--c-text3)">通过率 '+rate+'</span>';
        h+='</div>';
    });
    document.getElementById('compare-modal-body').innerHTML=h||'<div class="empty">无其他已完成的评测运行</div>';
}
function reloadBaselineInNav(runId){
    document.getElementById('compare-modal-body').innerHTML='<div class="empty">加载中...</div>';
    fetch(BASE+'/api/runs/'+runId).then(function(r){return r.json();}).then(function(d){
        if(d.code!=='10000'){toast('加载失败','err');return;}
        _compareBaseRun=d.data;
        document.getElementById('baseline-select').value=runId;
        renderCompareNav();
    });
}
function toggleFlagInNav(){
    if(!_compareMode||!_compareCaseList.length)return;
    var cur=_compareCaseList[_compareIdx];
    toggleCaseReviewFlag(_currentRun.id,cur.caseId,!cur.reviewFlagged);
}
function exitCompareMode(){
    _compareMode=false;
    _compareCaseList=[];
    _compareIdx=0;
    closeCompareModal();
}
document.addEventListener('keydown',function(e){
    if(e.key==='Escape'){
        var guide=document.getElementById('guide-overlay');
        if(guide&&guide.classList.contains('open')){guide.classList.remove('open');return;}
        if(_compareMode){exitCompareMode();return;}
        var cmp=document.getElementById('compare-overlay');
        if(cmp&&cmp.classList.contains('open')){closeCompareModal();return;}
        var dbg=document.getElementById('debug-overlay');
        if(dbg&&dbg.classList.contains('open')){closeDebugModal();return;}
    }
    if(_compareMode&&e.key==='ArrowLeft'){navigateCompare(-1);return;}
    if(_compareMode&&e.key==='ArrowRight'){navigateCompare(1);return;}
    if(_compareMode&&(e.key==='f'||e.key==='F')){toggleFlagInNav();return;}
});
function toggleRC(head){ var a=head.querySelector('.arr'),b=head.nextElementSibling; a.classList.toggle('open'); b.classList.toggle('open'); }
function downloadCsv(){
    if(!_currentRun||!_currentRun.results)return;
    var rows=[['caseId','caseName','pass','failReason','turn','userInput','llmReplyText','expectedTool','actualTool','toolOk','skillResult','hints']];
    (_currentRun.results||[]).forEach(function(r){
        var turns=r.turns||[];
        if(!turns.length){
            rows.push([r.caseId,r.caseName||'',r.pass?'PASS':'FAIL',r.failReason||'','','','','','','','','']);
        }
        turns.forEach(function(t){
            rows.push([r.caseId,r.caseName||'',r.pass?'PASS':'FAIL',r.failReason||'',
                t.turnIndex,t.userInput||'',t.llmReplyText||'',t.expectedTool||'',t.actualTool||'',
                t.toolOk?'OK':'MISS',t.skillResultJson||'',t.hintsJson||'']);
        });
    });
    var csv=rows.map(function(r){return r.map(function(c){return '"'+String(c).replace(/"/g,'""')+'"';}).join(',');}).join('\n');
    var blob=new Blob(['\uFEFF'+csv],{type:'text/csv;charset=utf-8;'});
    var a=document.createElement('a');
    a.href=URL.createObjectURL(blob);
    a.download=(_currentRun.runId||'results')+'.csv';
    a.click();
    URL.revokeObjectURL(a.href);
    toast('已下载','ok');
}
function addCaseCmt(runId,caseId){
    var el=document.getElementById('ci-'+caseId);
    var c=el?el.value.trim():'';
    if(!c){toast('评论不能为空','err');return;}
    fetch(BASE+'/api/runs/'+runId+'/cases/'+encodeURIComponent(caseId)+'/comments',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({content:c})})
    .then(r=>r.json()).then(d=>{if(d.code==='10000'){toast('已添加','ok');viewRun(runId);}else toast('评论失败','err');});
}
function editCmt(runId,caseId,cmtId){
    var el=document.getElementById('cc-'+cmtId);
    if(!el)return;
    var old=el.textContent;
    var input=document.createElement('textarea');
    input.className='fi'; input.style.cssText='font-size:13px;min-height:60px;resize:vertical';
    input.value=old;
    el.innerHTML='';
    el.appendChild(input);
    var btns=document.createElement('div');
    btns.style.cssText='margin-top:6px;display:flex;gap:6px';
    btns.innerHTML='<button class="btn btn-p btn-sm" id="cmt-save">保存</button><button class="btn btn-ghost btn-sm" id="cmt-cancel">取消</button>';
    el.appendChild(btns);
    var doSave=function(){
        var nv=input.value.trim();
        if(!nv){toast('评论不能为空','err');return;}
        fetch(BASE+'/api/runs/'+runId+'/cases/'+encodeURIComponent(caseId)+'/comments/'+cmtId,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({content:nv})})
        .then(r=>r.json()).then(d=>{if(d.code==='10000'){toast('已更新','ok');viewRun(runId);}else toast('更新失败','err');});
    };
    btns.querySelector('#cmt-save').onclick=doSave;
    btns.querySelector('#cmt-cancel').onclick=function(){ el.textContent=old; };
    input.addEventListener('keydown',function(ev){if(ev.key==='Enter'&&(ev.ctrlKey||ev.metaKey)){ev.preventDefault();doSave();}});
    input.focus();
}
function delCmt(runId,caseId,cmtId){
    if(!confirm('删除此评论?'))return;
    fetch(BASE+'/api/runs/'+runId+'/cases/'+encodeURIComponent(caseId)+'/comments/'+cmtId,{method:'DELETE'})
    .then(r=>r.json()).then(d=>{if(d.code==='10000'){toast('已删除','ok');viewRun(runId);}else toast('删除失败','err');});
}
