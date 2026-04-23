var BASE = '/admin/eval';
var PROJECT_NAME_KEY = 'evalAdminProjectName';
var PROJECT_ID_KEY = 'evalAdminProjectId';
var PROJECTS_KEY = 'evalAdminProjects';
var RUN_MOCK_CONFIG_KEY = 'evalRunMockConfigId';
var _rawFetch = window.fetch.bind(window);
var allCases = [], allRuns = [], polls = {};
var _workspaceProjects = [];
var _workspaceAccount = null;
var _debugData = [];
var _agentVersions = [];
var _caseGenerationSchema = null;
var ROUTE_TABS = { templates: true, cases: true, runs: true, mock: true };
var LLM_ALL_TOOLS=['RAG','freeChat','open_door','return_app_native_router','start_collect_merchant_location','update_user_agent_name','vehicle_control','vehicle_operation_data_query','vehicle_selective_query','voice_ticket_structuring','ticket_field_extract','ticket_category_route'];
var BUTTON_TOOLTIP_MAP={
    '预览':'根据当前 Prompt、分组和期望函数字段生成预览，不会入库',
    '加入用例库':'把预览逻辑生成的用例写入 Cases 列表，默认启用',
    '生成并加入用例库':'把预览逻辑生成的用例写入 Cases 列表，默认启用',
    '新建运行':'配置运行名称、Agent 版本与 Mock 数据集后启动评测',
    '+ 新建':'新增一个分组或轮次，具体取决于所在区域',
    '取消':'关闭当前弹窗，不保存本次修改',
    '保存':'保存当前用例字段到 Cases 列表',
    '刷新':'重新加载当前列表数据',
    '运行选中':'运行当前勾选的用例',
    '运行全部':'运行当前筛选范围内所有启用用例',
    '新建':'手动新建一条用例',
    '编辑':'打开并修改该用例',
    '删除':'删除该条记录',
    '详情':'查看本次运行的结果详情',
    '重跑':'用同一批用例重新创建一次运行'
};

function toast(msg,type,persistent){
    var box=document.getElementById('toast-box');
    if(!box) return null;
    var el=document.createElement('div');
    el.className='toast-item '+(type||'info');
    el.textContent=msg;
    box.appendChild(el);
    requestAnimationFrame(function(){el.classList.add('show');});
    if(!persistent){
        setTimeout(function(){
            el.classList.remove('show');
            setTimeout(function(){ if(el.parentNode) el.remove(); },300);
        },3500);
    }
    return el;
}

function dismissToast(el){
    if(!el) return;
    el.classList.remove('show');
    setTimeout(function(){ if(el.parentNode) el.remove(); },300);
}

window.fetch = function(input, init){
    var url = typeof input === 'string' ? input : (input && input.url) || '';
    var next = init || {};
    if(url.indexOf(BASE + '/api/') === 0 && url.indexOf(BASE + '/api/env') !== 0){
        var headers = next.headers instanceof Headers ? Object.fromEntries(next.headers.entries()) : Object.assign({}, next.headers || {});
        var projectId = localStorage.getItem(PROJECT_ID_KEY);
        if(projectId){
            var projects=parseStoredProjects();
            var valid=projects.some(function(p){return p&&p.projectId===projectId;});
            if(valid) headers['X-Project-Id'] = projectId;
        }
        next = Object.assign({}, next, { headers: headers });
    }
    return _rawFetch(input, next);
};

function setProjectBadge(projectName){
    var badge = document.getElementById('project-badge');
    if(!badge) return;
    if(projectName){
        badge.textContent = projectName;
        badge.style.display = 'inline-block';
    } else {
        badge.style.display = 'none';
    }
}

function parseStoredProjects(){
    try{
        var raw=localStorage.getItem(PROJECTS_KEY);
        var list=raw?JSON.parse(raw):[];
        return Array.isArray(list)?list:[];
    }catch(e){
        return [];
    }
}

function setWorkspaceProjects(projects, activeProjectId){
    projects=Array.isArray(projects)?projects:[];
    _workspaceProjects=projects;
    if(projects.length){
        localStorage.setItem(PROJECTS_KEY, JSON.stringify(projects));
    }else{
        localStorage.removeItem(PROJECTS_KEY);
    }
    var active=projects.find(function(p){return p.projectId===activeProjectId;})||projects[0]||null;
    if(active){
        localStorage.setItem(PROJECT_ID_KEY, active.projectId);
        localStorage.setItem(PROJECT_NAME_KEY, active.projectName || active.projectId);
        setProjectBadge(active.projectName || active.projectId);
    }else{
        localStorage.removeItem(PROJECT_ID_KEY);
        localStorage.removeItem(PROJECT_NAME_KEY);
        setProjectBadge('');
    }
    var sel=document.getElementById('project-switcher');
    if(sel){
        if(projects.length>1){
            sel.innerHTML=projects.map(function(p){return '<option value="'+ea(p.projectId)+'">'+esc(p.projectName||p.projectId)+'</option>';}).join('');
            sel.value=(active&&active.projectId)||projects[0].projectId;
            sel.style.display='inline-block';
        }else{
            sel.style.display='none';
            sel.innerHTML='';
        }
    }
    renderWorkspaceHome();
}

function switchWorkspaceProject(projectId){
    enterWorkspaceProject(projectId,'cases');
}

function activeWorkspaceProject(){
    var projectId=localStorage.getItem(PROJECT_ID_KEY);
    var projects=_workspaceProjects.length?_workspaceProjects:parseStoredProjects();
    return projects.find(function(p){return p&&p.projectId===projectId;})||projects[0]||null;
}

function projectCaseCount(project, metric){
    if(!metric||!metric.sourceGroup) return allCases.length;
    return allCases.filter(function(c){return (c.groupName||'默认分组')===metric.sourceGroup;}).length;
}

function renderProjectMetrics(project){
    var metrics=(project&&project.primaryMetrics)||[];
    if(!metrics.length) metrics=[{key:'cases',label:'用例'},{key:'runs',label:'运行'},{key:'tools',label:'工具'}];
    return metrics.map(function(m){
        var value=m.sourceGroup?projectCaseCount(project,m):(m.key==='runs'?allRuns.length:((project.tools||[]).length||allCases.length));
        return '<div class="project-metric"><b>'+value+'</b><span>'+esc(m.label)+'</span></div>';
    }).join('');
}

function renderWorkspaceHome(){
    var grid=document.getElementById('workspace-project-grid');
    if(!grid) return;
    var account=document.getElementById('workspace-account');
    if(account&&_workspaceAccount) account.textContent=(_workspaceAccount.accountName||'测试人员')+' · '+_workspaceProjects.length+' 个项目';
    var projects=_workspaceProjects.length?_workspaceProjects:parseStoredProjects();
    if(!projects.length){
        grid.innerHTML='<div class="card" style="padding:18px;color:var(--c-text2)">暂无可访问项目</div>';
        return;
    }
    grid.innerHTML=projects.map(function(p){
        var modules=(p.homeModules&&p.homeModules.length?p.homeModules:[
            {label:'Templates',targetTab:'templates'},
            {label:'Cases',targetTab:'cases'},
            {label:'Runs',targetTab:'runs'},
            {label:'Mock',targetTab:'mock'}
        ]);
        return '<div class="project-card">'+
            '<h2>'+esc(p.projectName||p.projectId)+'</h2>'+
            '<p>'+esc(p.homeSummary||'项目评测空间')+'</p>'+
            '<div class="project-metrics">'+renderProjectMetrics(p)+'</div>'+
            '<div class="project-module-grid">'+modules.map(function(m){
                return '<button class="btn btn-flat btn-sm" onclick="enterWorkspaceProject(\''+ea(p.projectId)+'\',\''+ea(m.targetTab||'cases')+'\')">'+esc(m.label||m.key||m.targetTab)+'</button>';
            }).join('')+'</div>'+
            '<div class="project-card-actions">'+
                '<span class="tag" style="background:var(--c-blue-bg);color:var(--c-blue)">'+esc(p.role||'member')+'</span>'+
                '<button class="btn btn-p btn-sm" onclick="enterWorkspaceProject(\''+ea(p.projectId)+'\',\'cases\')">进入 Cases</button>'+
            '</div>'+
        '</div>';
    }).join('');
}

function moduleHint(tab){
    if(tab==='templates') return '管理 function 对应的评测骨架';
    if(tab==='cases') return '管理当前项目的用例结构';
    if(tab==='runs') return '查看当前项目的评测运行';
    if(tab==='mock') return '配置当前项目的数据环境';
    return '进入模块';
}

function enterWorkspaceProject(projectId,targetTab){
    var projects=parseStoredProjects();
    var active=projects.find(function(p){return p.projectId===projectId;});
    if(!active)return;
    localStorage.setItem(PROJECT_ID_KEY, active.projectId);
    localStorage.setItem(PROJECT_NAME_KEY, active.projectName || active.projectId);
    setProjectBadge(active.projectName || active.projectId);
    refreshWorkspaceForProject(targetTab||'cases');
}

function refreshWorkspaceForProject(targetTab){
    allCases=[];
    allRuns=[];
    if(window.resetTemplatesState) resetTemplatesState();
    _mcList=[];
    loadCases();
    loadVersionOptions();
    checkRunning();
    loadRuns();
    go(targetTab||'cases');
    toast('已进入 '+(localStorage.getItem(PROJECT_NAME_KEY)||'项目控制台'),'ok');
}

function openWorkspaceHome(){
    document.querySelectorAll('.pane').forEach(function(p){p.classList.remove('active');});
    var home=document.getElementById('workspace-home');
    if(home) home.classList.add('active');
    document.querySelectorAll('.nav-item[data-tab]').forEach(function(n){ n.classList.toggle('active',n.getAttribute('data-tab')==='workspace'); });
    setProjectBadge('');
    renderWorkspaceHome();
    setRoute('workspace');
}

function routeTabFromLocation(){
    var path=(window.location&&window.location.pathname)||'';
    var marker=BASE + '/';
    var idx=path.indexOf(marker);
    var segment=idx>=0 ? path.slice(idx + marker.length).split('/')[0] : '';
    if(ROUTE_TABS[segment]) return segment;
    return 'workspace';
}

function routeForTab(tab){
    return tab && tab !== 'workspace' ? BASE + '/' + tab : BASE;
}

function setRoute(tab, replace){
    if(!window.history || !window.history.pushState) return;
    var next=routeForTab(tab);
    if(window.location.pathname===next) return;
    var method=replace?'replaceState':'pushState';
    window.history[method]({tab:tab||'workspace'}, '', next);
}

function applyInitialRoute(){
    var tab=routeTabFromLocation();
    if(tab==='workspace') openWorkspaceHome();
    else go(tab, { replace: true });
}

function initWorkspace(done){
    var headers = {};
    var projectId = localStorage.getItem(PROJECT_ID_KEY);
    if(projectId) headers['X-Project-Id'] = projectId;
    _rawFetch(BASE + '/api/auth/status', { headers: headers })
        .then(function(r){ return r.json(); })
        .then(function(d){
            var data=d.data||{};
            _workspaceAccount=data.account||null;
            setWorkspaceProjects(data.projects || [], data.activeProjectId || (data.project&&data.project.projectId) || localStorage.getItem(PROJECT_ID_KEY));
            done();
        })
        .catch(function(){
            _workspaceAccount={accountId:'tester',accountName:'测试人员'};
            setWorkspaceProjects([
                {projectId:'vehicle-agent-eval',projectName:'车辆 Agent 评测',role:'member'},
                {projectId:'voice-ticket-eval',projectName:'语音工单结构化评测',role:'member'}
            ], localStorage.getItem(PROJECT_ID_KEY)||'vehicle-agent-eval');
            done();
        });
}

var _booted = false;
function bootApp(){
    if(_booted) return;
    _booted = true;
    tick(); setInterval(tick, 60000);
    document.getElementById('case-q').addEventListener('input', filterCases);
    document.getElementById('run-q').addEventListener('input', filterRuns);
    document.addEventListener('keydown', function(e){
        if(e.key==='Escape'){closeCM();closeRunConfirm();closeExportConfirm();closeReadCmtFloat();}
        if(e.key==='Enter'){
            // 阅读模式评论浮窗：Ctrl+Enter 发送
            var cmtFloat=document.getElementById('read-cmt-float');
            if(cmtFloat&&cmtFloat.style.display!=='none'&&e.ctrlKey){e.preventDefault();submitReadCmtFloat();return;}
            // Export 确认弹窗
            var ecOl=document.getElementById('ol-export-confirm');
            if(ecOl&&ecOl.classList.contains('open')){e.preventDefault();var eb=document.getElementById('ec-ok');if(eb&&eb.onclick)eb.onclick();return;}
            // Run 确认弹窗
            var rcOl=document.getElementById('ol-run-confirm');
            if(rcOl&&rcOl.classList.contains('open')){e.preventDefault();var ob=document.getElementById('rc-ok');if(ob&&ob.onclick)ob.onclick();return;}
            // Case 弹窗（排除 textarea 焦点）
            var cmOl=document.getElementById('ol-case');
            if(cmOl&&cmOl.classList.contains('open')&&document.activeElement&&document.activeElement.tagName!=='TEXTAREA'){e.preventDefault();saveCase();return;}
        }
    });
    window.addEventListener('resize', function(){
        var p=document.getElementById('read-cmt-float');
        if(!p||p.style.display==='none'||_readCmtFloatIdx<0)return;
        var b=document.getElementById('read-cmt-btn-'+_readCmtFloatIdx);
        if(b) positionReadCmtFloat(b);
    });
    ['ol-case','ol-run-confirm','ol-export-confirm'].forEach(function(id){ document.getElementById(id).addEventListener('click',function(e){if(e.target===this)this.classList.remove('open');}); });
    loadCases();
    loadVersionOptions();
    checkRunning();
    loadEnv();
    applyInitialRoute();
    applyButtonTooltips();
}

window.startEvalApp = function startEvalApp(){
    initWorkspace(bootApp);
};
window.addEventListener('popstate', function(){
    var tab=routeTabFromLocation();
    if(tab==='workspace') openWorkspaceHome();
    else go(tab, { replace: true });
});
function applyButtonTooltips(root){
    (root||document).querySelectorAll('button').forEach(function(btn){
        if(btn.title) return;
        var key=(btn.textContent||'').replace(/\s+/g,' ').trim();
        if(BUTTON_TOOLTIP_MAP[key]) btn.title=BUTTON_TOOLTIP_MAP[key];
    });
}
function tick(){ document.getElementById('clock').textContent = new Date().toLocaleString('zh-CN',{year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit'}); }
function loadEnv(){
    fetch(BASE+'/api/env').then(function(r){return r.json();}).then(function(d){
        if(d.code==='10000'&&d.data&&d.data.env){
            var b=document.getElementById('env-badge');
            b.textContent=d.data.env;
            b.style.display='inline-block';
        }
    }).catch(function(){});
}
function loadVersionOptions(cb){
    fetch(BASE+'/api/agent-versions').then(function(r){return r.json();}).catch(function(){return {data:[]};}).then(function(result){
        _agentVersions=(result&&result.code==='10000')?(result.data||[]):[];
        renderVersionOptions();
        if(cb) cb();
    });
}
function renderVersionOptions(){
    var runAgent=document.getElementById('run-agent-filter');
    if(runAgent){
        var current=runAgent.value;
        runAgent.innerHTML='<option value="">Agent 版本筛选：全部</option>'+
            _agentVersions.map(function(v){return '<option value="'+esc(v.version)+'">'+esc(v.label||v.version)+'</option>';}).join('');
        runAgent.value=current;
    }
    var rcAgent=document.getElementById('rc-agent-version');
    if(rcAgent){
        rcAgent.innerHTML=_agentVersions.map(function(v){return '<option value="'+esc(v.version)+'">'+esc(v.label||v.version)+'</option>';}).join('');
    }
}

/* ── Nav ── */
function go(t, options){
    options=options||{};
    var tabs=['templates','cases','runs','mock'];
    if(tabs.indexOf(t)<0) t='cases';
    var workspace=document.getElementById('workspace-home');
    if(workspace) workspace.classList.remove('active');
    var project=activeWorkspaceProject();
    if(project) setProjectBadge(project.projectName||project.projectId);
    document.querySelectorAll('.nav-item[data-tab]').forEach(function(n){ n.classList.toggle('active',n.getAttribute('data-tab')===t); });
    tabs.forEach(function(n){ document.getElementById('p-'+n).classList.toggle('active',n===t); });
    if(t==='runs') loadRuns();
    if(t==='templates') loadTemplates();
    if(t==='mock') loadMock();
    try{localStorage.setItem('eval_tab',t);}catch(e){}
    setRoute(t, options.replace);
}
