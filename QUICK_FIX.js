// 快速修复：在 renderOverview 和 renderFinance 中添加空值检查

function renderOverview() {
  const me = appState.me || {};
  const usage = appState.usage || {};
  const sub = appState.subSelf || {};

  if (els.userName) els.userName.textContent = me.username || me.name || "User";
  if (els.currentDate) els.currentDate.textContent = new Date().toLocaleDateString("zh-CN", { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });

  if (els.statBalance) els.statBalance.textContent = normalizeNumber(me.quota ?? me.balance);
  const totalUsed = Array.isArray(usage) ? usage.reduce((a, b) => a + (b.quota || 0), 0) : 0;
  if (els.statUsage) els.statUsage.textContent = normalizeNumber(totalUsed);
  if (els.statSub) els.statSub.textContent = (sub.subscriptions || []).length;

  if (appState.affiliate && els.statAffiliate) {
    els.statAffiliate.textContent = `+${appState.affiliate.history_amount || 0}`;
  }

  renderUsageChart();
}

function renderFinance() {
  const info = appState.topupInfo || {};
  const options = info.amount_options || [10, 20, 50, 100, 200];
  if (els.amountOptions) {
    els.amountOptions.innerHTML = options.map(a => `<div class="amount-chip ${a === appState.selectedPayAmount ? 'active' : ''}" data-amount="${a}">￥${a}</div>`).join("");
  }
  if (els.methodOptions) {
    els.methodOptions.innerHTML = appState.paymentMethods.map(m => `<div class="item-card method-chip ${m === appState.selectedPayMethod ? 'active' : ''}" data-method="${m}" style="cursor:pointer; margin-bottom:8px; border:2px solid ${m === appState.selectedPayMethod ? 'var(--accent)' : 'transparent'}"><span style="font-weight:700">${m.toUpperCase()}</span></div>`).join("");
  }
  const sub = appState.subSelf || {};
  if (els.subSelf) {
    els.subSelf.innerHTML = (sub.subscriptions || []).map(s => `<div class="item-card" style="background:var(--bg-secondary); border:none;"><div><div style="font-size:11px; font-weight:700; color:var(--text-secondary)">活跃订阅</div><div style="font-weight:700">Plan #${s.plan_id}</div></div><div class="badge">ACTIVE</div></div>`).join("") || '<div class="item-card" style="opacity:0.6; font-size:13px; justify-content:center;">暂无活跃订阅</div>';
  }
  if (els.plansCount) els.plansCount.textContent = (appState.plans || []).length;
  if (els.plansList) {
    els.plansList.innerHTML = (appState.plans || []).map(p => `
    <div class="card glass" style="padding:20px; margin-bottom:12px; border-radius:20px;">
      <div style="display:flex; justify-content:space-between; align-items:flex-start;">
        <div><h4 style="font-weight:700">${p.title || "套餐"}</h4><p style="font-size:12px; color:var(--text-secondary)">${p.upgrade_group || "default"}</p></div>
        <div style="text-align:right"><div style="font-size:20px; font-weight:800; color:var(--accent)">￥${p.price_amount}</div><div style="font-size:11px; opacity:0.6">${p.days}天</div></div>
      </div>
      <div style="display:flex; gap:8px; margin-top:16px;">
        ${appState.paymentMethods.map(m => `<button class="primary-button plan-buy" style="flex:1; padding:8px; font-size:12px; height:auto;" data-plan-id="${p.id}" data-method="${m}">${m.toUpperCase()}</button>`).join("")}
      </div>
    </div>`).join("");
  }
  if (els.topupList) {
    els.topupList.innerHTML = (appState.topupRecords || []).slice(0, 10).map(r => `<div class="item-card" style="font-size:13px;"><span>￥${r.amount} · ${r.payment_method}</span><span style="opacity:0.6">${formatDate(r.created_at)}</span></div>`).join("");
  }
}

// 将这两个函数替换到 app.js 中的对应位置
