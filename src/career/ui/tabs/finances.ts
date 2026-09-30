// Money & home: weekly budget and ledger; the housing ladder (rent or buy by district) and
// transport; diet, sleep and hobbies; investments; education and coaching badges; charity.

import { h } from '../../../ui/dom';
import { formatDate } from '../../core/dates';
import { COURSES, DIETS, HOBBIES, INVESTMENTS, SLEEP, TRANSPORT } from '../../core/data/lifestyle';
import { city } from '../../core/index';
import { FOUNDATION_COST, MORTGAGE_DEPOSIT, mortgageBlocked, mortgagePayment, buyHobby, buyTransport, donate, enrollCourse, housingDef, housingOptions, invest, livesIn, moveHouse, propertyRent, netWeeklyWage, sellProperty, startFoundation, weeklyCosts, withdraw } from '../../core/life';
import { userAge } from '../../core/footballer';
import type { CareerApp } from '../app';
import { btn, card, emptyState, keyValue, money, pill, table } from '../components';

function tabs(app: CareerApp, current: string): HTMLElement {
  const mk = (key: string, label: string) => h('button', { class: `tab ${current === key ? 'is-active' : ''}`, type: 'button', onclick: () => app.setSub(key) }, label);
  return h('div', { class: 'tabs cc-subtabs' }, mk('money', 'Budget'), mk('home', 'Home & transport'), mk('lifestyle', 'Lifestyle'), mk('invest', 'Investments'), mk('education', 'Education'), mk('charity', 'Charity'));
}

export function renderFinances(app: CareerApp): HTMLElement {
  const s = app.state;
  const life = s.life;
  const sub = app.sub.finances ?? 'money';
  const cur = (v: number) => money(s, v);
  let body: HTMLElement;

  if (sub === 'home') {
    const opts = housingOptions(s);
    const current = housingDef(life.housing.kind);
    const c = city(s, life.cityId);
    const kinds = ['digs', 'family', 'shared', 'apartment', 'house', 'villa'] as const;
    body = h(
      'div',
      { class: 'cc-grid' },
      card('Where you live', [
        h('p', {}, h('strong', {}, current.name), ` in ${c.districts[life.district].name}, ${c.name}`),
        h('p', { class: 'cc-dim' }, current.desc),
        keyValue([['Rent', life.housing.owned ? 'Owned' : life.housing.weekly ? `${cur(life.housing.weekly)}/week` : 'Free'], ['Comfort', `${current.comfort}/100`], ['Since', formatDate(life.housing.since)]]),
      ]),
      card('Housing market', [
        h('p', { class: 'cc-dim' }, `Comfort improves sleep and home happiness; prestigious districts cost more but impress. Buy outright, or with a mortgage: a ${Math.round(MORTGAGE_DEPOSIT * 100)}% deposit and weekly repayments over 15 years (a professional contract needed). Property keeps its value.`),
        ...kinds.map((k) => {
          const list = opts.filter((o) => o.kind === k);
          if (!list.length) return null;
          const def = housingDef(k);
          return h(
            'div',
            { class: 'cc-house-group' },
            h('h4', { class: 'cc-h4' }, def.name, h('span', { class: 'cc-dim' }, ` · comfort ${def.comfort}`)),
            h('p', { class: 'cc-dim cc-small' }, def.desc),
            table(
              ['District', 'Rent / week', 'Buy', ''],
              list.map((o) => {
                const here = life.housing.kind === o.kind && life.district === o.district;
                return [
                  o.districtName,
                  o.weekly ? cur(o.weekly) : 'Free',
                  o.price ? cur(o.price) : '—',
                  h(
                    'span',
                    { class: 'cc-row-actions' },
                    here ? pill('Current', 'good') : btn(o.weekly ? 'Rent' : 'Move in', () => {
                      const err = moveHouse(s, o, false);
                      app.toast(err ?? `Moved into ${o.name}`, err ? 'warn' : 'success');
                      app.render();
                    }, 'ghost', { small: true, disabled: o.blocked ?? false }),
                    !here && o.price && life.money >= o.price ? btn('Buy', () => {
                      const err = moveHouse(s, o, true);
                      app.toast(err ?? `You bought a ${o.name.toLowerCase()}!`, err ? 'warn' : 'success');
                      app.render();
                    }, 'ghost', { small: true, disabled: o.blocked ?? (life.money < o.price ? 'Not enough money' : false) }) : null,
                    !here && o.price && life.money < o.price ? btn('Mortgage', () => {
                      const err = moveHouse(s, o, true, true);
                      app.toast(err ?? `Keys in hand! Mortgage repayments: ${cur(mortgagePayment(o.price - Math.round(o.price * MORTGAGE_DEPOSIT)))}/week`, err ? 'warn' : 'success');
                      app.render();
                    }, 'ghost', { small: true, disabled: o.blocked ?? mortgageBlocked(s, o) ?? false, title: (o.blocked ?? mortgageBlocked(s, o)) ?? `${Math.round(MORTGAGE_DEPOSIT * 100)}% deposit (${cur(Math.round(o.price * MORTGAGE_DEPOSIT))}), then ${cur(mortgagePayment(o.price - Math.round(o.price * MORTGAGE_DEPOSIT)))}/week for 15 years` }) : null,
                  ),
                ];
              }),
            ),
          );
        }),
      ]),
      card('Your property', life.properties.length ? [table(['Home', 'City', 'Value', 'Use', ''], life.properties.map((p, i) => [housingDef(p.kind).name, city(s, p.cityId).name, cur(p.value), h('span', { class: 'cc-cell-stack' }, h('span', {}, livesIn(s, p) ? 'Your home' : `Let out · ${cur(propertyRent(p))}/month`), p.mortgage ? h('span', { class: 'cc-dim cc-small' }, `Mortgage: ${cur(p.mortgage)} left · ${cur(p.mortgageWeekly ?? 0)}/wk`) : null), livesIn(s, p) ? '' : btn('Sell', () => (app.toast(`Sold for ${cur(sellProperty(s, i))}`, 'success'), app.render()), 'ghost', { small: true })])), h('p', { class: 'cc-dim cc-small' }, 'Homes you own but do not live in are let out. Property values follow the market.')] : [emptyState('You do not own property yet. Buying instead of renting builds wealth — and a let-out home pays rent.')]),
      card('Transport', [
        h('p', { class: 'cc-dim' }, 'Better transport makes the commute less tiring. Your old vehicle is traded in.'),
        table(
          ['', 'Price', 'Running cost', 'Commute', ''],
          TRANSPORT.map((t) => [t.name, t.price ? cur(t.price) : '—', `${cur(t.weekly)}/wk`, `×${t.commute.toFixed(2)}`, life.transport === t.kind ? pill('Yours', 'good') : btn('Buy', () => {
            const err = buyTransport(s, t.kind);
            app.toast(err ?? `New ride: ${t.name}`, err ? 'warn' : 'success');
            app.render();
          }, 'ghost', { small: true, disabled: userAge(s) < t.minAge ? `From age ${t.minAge}` : false })]),
        ),
      ]),
    );
  } else if (sub === 'lifestyle') {
    body = h(
      'div',
      { class: 'cc-grid cc-grid--2' },
      card('Diet', [h('p', { class: 'cc-dim' }, 'Food fuels recovery, fitness and injury resistance.'), ...DIETS.map((d) => h('button', { class: `cc-option ${life.diet === d.kind ? 'is-selected' : ''}`, type: 'button', onclick: () => ((life.diet = d.kind), app.render()) }, h('strong', {}, d.name), h('span', { class: 'cc-dim' }, d.desc), h('span', { class: 'cc-pills' }, pill(`${cur(Math.round(d.weekly * city(s, life.cityId).cost))}/wk`, 'dim'), pill(`Recovery ×${d.recovery.toFixed(2)}`, d.recovery >= 1 ? 'good' : 'bad'), pill(`Injuries ×${d.injury.toFixed(2)}`, d.injury <= 1 ? 'good' : 'bad'))))]),
      card('Sleep', [h('p', { class: 'cc-dim' }, 'Your bedtime habits.'), ...SLEEP.map((d) => h('button', { class: `cc-option ${life.sleep === d.kind ? 'is-selected' : ''}`, type: 'button', onclick: () => ((life.sleep = d.kind), app.render()) }, h('strong', {}, d.name), h('span', { class: 'cc-dim' }, d.desc), h('span', { class: 'cc-pills' }, pill(`Recovery ×${d.recovery.toFixed(2)}`, d.recovery >= 1 ? 'good' : 'bad'))))]),
      card('Hobbies', [
        h('p', { class: 'cc-dim' }, 'Hobbies relax you (practise them at home in a free slot) and some sharpen your mind or grow your following.'),
        h('div', { class: 'cc-hobbies' }, ...HOBBIES.map((hb) => {
          const owned = life.hobbies[hb.key] !== undefined;
          return h('div', { class: 'cc-hobby' }, h('strong', {}, hb.name), h('span', { class: 'cc-dim' }, hb.desc), owned ? pill(`Skill ${Math.round(life.hobbies[hb.key])}`, 'good') : btn(`Start (${cur(Math.round(hb.price * city(s, life.cityId).cost))})`, () => {
            const err = buyHobby(s, hb.key);
            app.toast(err ?? `New hobby: ${hb.name}`, err ? 'warn' : 'success');
            app.render();
          }, 'ghost', { small: true }));
        })),
      ]),
    );
  } else if (sub === 'invest') {
    const amount = h('input', { class: 'cc-input', type: 'number', min: '100', step: '100', value: String(Math.max(1000, Math.round(Math.max(0, life.money) * 0.2 / 100) * 100)), 'aria-label': 'Amount' });
    const product = h('select', { class: 'cc-select', 'aria-label': 'Product' }, ...INVESTMENTS.map((i) => h('option', { value: i.key }, `${i.name} — ${i.desc}`)));
    body = h(
      'div',
      { class: 'cc-grid cc-grid--2' },
      card('Portfolio', life.investments.length ? [table(['Product', 'Value', 'Since', ''], life.investments.map((i) => [i.name, cur(i.amount), formatDate(i.since), btn('Withdraw', () => (app.toast(`Withdrew ${cur(withdraw(s, i.key))}`, 'success'), app.render()), 'ghost', { small: true })]))] : [emptyState('Nothing invested. Money in the bank does nothing.')]),
      card('Invest', [
        h('div', { class: 'cc-form' }, h('label', {}, 'Product', product), h('label', {}, 'Amount', amount)),
        btn('Invest', () => {
          const ok = invest(s, product.value, Math.round(Number(amount.value)));
          app.toast(ok ? 'Invested' : 'Not enough money', ok ? 'success' : 'warn');
          app.render();
        }, 'primary'),
        h('p', { class: 'cc-dim' }, 'Returns are paid monthly and can be negative. Riskier products swing more.'),
      ]),
    );
  } else if (sub === 'education') {
    const edu = life.education;
    const school = life.school;
    body = h(
      'div',
      { class: 'cc-grid cc-grid--2' },
      card('School', [school.graduated ? h('p', {}, 'You have finished school.') : h('p', {}, `Academy school: weekday afternoons until you are 17½. Attended ${school.attended} days.`)]),
      card('Courses & coaching badges', [
        h('p', { class: 'cc-dim' }, 'Study at the College in a free slot. What you learn decides what you can do after football.'),
        ...COURSES.map((c) => {
          const done = edu.completed.includes(c.key);
          const enrolled = edu.enrolled === c.key;
          const prog = edu.progress[c.key] ?? 0;
          return h(
            'div',
            { class: 'cc-course' },
            h('div', {}, h('strong', {}, c.name), h('span', { class: 'cc-dim' }, ` · ${c.sessions} sessions · ${cur(c.costPerSession)} each`)),
            h('p', { class: 'cc-dim cc-small' }, `${c.desc} Unlocks: ${c.unlocks}.`),
            done ? pill('Completed', 'good') : enrolled ? pill(`Enrolled · ${prog}/${c.sessions}`, 'info') : btn('Enrol', () => {
              const err = enrollCourse(s, c.key);
              app.toast(err ?? `Enrolled: ${c.name}`, err ? 'warn' : 'success');
              app.render();
            }, 'ghost', { small: true, disabled: userAge(s) < c.minAge ? `From age ${c.minAge}` : c.requires && !edu.completed.includes(c.requires) ? `Requires ${COURSES.find((x) => x.key === c.requires)?.name}` : false }),
          );
        }),
      ]),
    );
  } else if (sub === 'charity') {
    const ch = life.charity;
    body = h(
      'div',
      { class: 'cc-grid cc-grid--2' },
      card('Giving back', [
        keyValue([['Donated', cur(ch.donated)], ['Community points', String(ch.points)], ['Foundation', ch.foundation ? 'Running' : 'None']]),
        h('div', { class: 'cc-row-actions' }, ...[500, 5000, 50000].map((v) => btn(`Donate ${cur(v)}`, () => {
          const ok = donate(s, v);
          app.toast(ok ? 'Thank you for your donation' : 'Not enough money', ok ? 'success' : 'warn');
          app.render();
        }, 'ghost', { small: true, disabled: life.money < v ? 'Not enough money' : false }))),
        h('p', { class: 'cc-dim' }, 'Hospital visits and coaching kids (Community Centre) also count.'),
      ]),
      card('Your own foundation', [
        h('p', { class: 'cc-dim' }, `A foundation costs ${cur(FOUNDATION_COST)} to set up plus monthly running costs. It builds your reputation and shapes your legacy.`),
        ch.foundation ? pill('Your foundation is running', 'gold') : btn('Start a foundation', () => {
          const ok = startFoundation(s);
          app.toast(ok ? 'Foundation launched!' : 'Not enough money', ok ? 'success' : 'warn');
          app.render();
        }, 'primary', { disabled: life.money < FOUNDATION_COST ? 'Not enough money' : false }),
      ]),
    );
  } else {
    const w = netWeeklyWage(s);
    const costs = weeklyCosts(s);
    const totalCosts = costs.reduce((a, c) => a + c.amount, 0);
    const sponsors = life.sponsors.reduce((a, x) => a + x.monthly, 0);
    body = h(
      'div',
      { class: 'cc-grid cc-grid--2' },
      card('Weekly budget', [
        h('div', { class: 'cc-balance' }, h('span', { class: 'cc-dim' }, 'Balance'), h('strong', { class: life.money < 0 ? 'cc-bad' : '' }, cur(life.money))),
        table(['Income', 'Per week'], [['Wage (gross)', cur(w.gross)], ['Tax', `−${cur(w.tax)}`], ['Agent fee', w.agentFee ? `−${cur(w.agentFee)}` : '—'], [h('strong', {}, 'Net wage'), h('strong', {}, cur(w.net))], ['Sponsors (monthly ÷ 4.3)', cur(Math.round(sponsors / 4.3))]]),
        table(['Expenses', 'Per week'], [...costs.map((c) => [c.label, `−${cur(c.amount)}`]), [h('strong', {}, 'Total'), h('strong', {}, `−${cur(totalCosts)}`)]]),
        h('p', { class: w.net + sponsors / 4.3 - totalCosts >= 0 ? 'cc-good' : 'cc-bad' }, `Net per week: ${cur(Math.round(w.net + sponsors / 4.3 - totalCosts))}`),
      ]),
      card('Sponsors', life.sponsors.length ? [table(['Brand', 'Per month', 'Duties', 'Until'], life.sponsors.map((x) => [h('span', { class: 'cc-cell-stack' }, h('strong', {}, x.brand), h('span', { class: 'cc-dim cc-small' }, x.category)), cur(x.monthly), `${x.dutiesDone}/${x.duties}`, formatDate(x.endDay)])), h('p', { class: 'cc-dim cc-small' }, 'Duties: promotional evenings this month (Agent Office → Sponsor appearance). Skipped duties cut the payment.')] : [emptyState('No sponsors yet. Fame brings offers.')]),
      card('Recent transactions', life.ledger.length ? [table(['Date', 'What', 'Amount'], life.ledger.slice(0, 30).map((l) => [formatDate(l.day), l.label, h('span', { class: l.amount >= 0 ? 'cc-good' : 'cc-bad' }, `${l.amount >= 0 ? '+' : ''}${cur(l.amount)}`)]))] : [emptyState('No transactions yet.')]),
    );
  }
  return h('div', { class: 'cc-page' }, tabs(app, sub), body);
}
