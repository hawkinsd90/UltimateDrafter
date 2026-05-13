import { useState } from 'react';

export type ScoringRules = Record<string, number>;

interface StatDef {
  key: string;
  label: string;
  defaultValue: number;
}

interface Category {
  id: string;
  label: string;
  stats: StatDef[];
}

const CATEGORIES: Category[] = [
  {
    id: 'passing',
    label: 'Passing',
    stats: [
      { key: 'pass_yd',       label: 'Passing Yards (per)',   defaultValue: 0.04 },
      { key: 'pass_td',       label: 'TD Pass',               defaultValue: 4 },
      { key: 'pass_int',      label: 'Interception Thrown',   defaultValue: -2 },
      { key: 'pass_2pt',      label: '2pt Passing Conv.',     defaultValue: 2 },
      { key: 'pass_cmp',      label: 'Completion',            defaultValue: 0 },
      { key: 'pass_inc',      label: 'Incompletion',          defaultValue: 0 },
      { key: 'pass_sack',     label: 'Sacked',                defaultValue: 0 },
      { key: 'pass_fd',       label: 'Passing First Down',    defaultValue: 0 },
      { key: 'pass_300_yds',  label: '300-399 yd game bonus', defaultValue: 0 },
      { key: 'pass_400_yds',  label: '400+ yd game bonus',    defaultValue: 0 },
    ],
  },
  {
    id: 'rushing',
    label: 'Rushing',
    stats: [
      { key: 'rush_yd',       label: 'Rushing Yards (per)',   defaultValue: 0.1 },
      { key: 'rush_td',       label: 'TD Rush',               defaultValue: 6 },
      { key: 'rush_2pt',      label: '2pt Rushing Conv.',     defaultValue: 2 },
      { key: 'rush_fd',       label: 'Rushing First Down',    defaultValue: 0 },
      { key: 'rush_100_yds',  label: '100-199 yd game bonus', defaultValue: 0 },
      { key: 'rush_200_yds',  label: '200+ yd game bonus',    defaultValue: 0 },
    ],
  },
  {
    id: 'receiving',
    label: 'Receiving',
    stats: [
      { key: 'rec',           label: 'Reception',              defaultValue: 0 },
      { key: 'rec_yd',        label: 'Receiving Yards (per)',  defaultValue: 0.1 },
      { key: 'rec_td',        label: 'TD Reception',           defaultValue: 6 },
      { key: 'rec_2pt',       label: '2pt Receiving Conv.',    defaultValue: 2 },
      { key: 'rec_fd',        label: 'Receiving First Down',   defaultValue: 0 },
      { key: 'rec_100_yds',   label: '100-199 yd game bonus',  defaultValue: 0 },
      { key: 'rec_200_yds',   label: '200+ yd game bonus',     defaultValue: 0 },
      { key: 'rec_tgt',       label: 'Target',                 defaultValue: 0 },
    ],
  },
  {
    id: 'kicking',
    label: 'Kicking',
    stats: [
      { key: 'xpm',           label: 'PAT Made',               defaultValue: 1 },
      { key: 'xpmiss',        label: 'PAT Missed',             defaultValue: 0 },
      { key: 'fg_0_19',       label: 'FG Made (0-19 yds)',     defaultValue: 3 },
      { key: 'fg_20_29',      label: 'FG Made (20-29 yds)',    defaultValue: 3 },
      { key: 'fg_30_39',      label: 'FG Made (30-39 yds)',    defaultValue: 3 },
      { key: 'fg_40_49',      label: 'FG Made (40-49 yds)',    defaultValue: 4 },
      { key: 'fg_50_59',      label: 'FG Made (50-59 yds)',    defaultValue: 5 },
      { key: 'fg_60p',        label: 'FG Made (60+ yds)',      defaultValue: 5 },
      { key: 'fgmiss',        label: 'FG Missed (0-39 yds)',   defaultValue: -1 },
      { key: 'fgmiss_40_49',  label: 'FG Missed (40-49 yds)', defaultValue: 0 },
      { key: 'fgmiss_50p',    label: 'FG Missed (50+ yds)',    defaultValue: 0 },
    ],
  },
  {
    id: 'dst',
    label: 'Team Defense / ST',
    stats: [
      { key: 'def_sack',      label: 'Sack',                   defaultValue: 1 },
      { key: 'def_int',       label: 'Interception',           defaultValue: 2 },
      { key: 'def_fum_rec',   label: 'Fumble Recovered',       defaultValue: 2 },
      { key: 'def_safe',      label: 'Safety',                 defaultValue: 2 },
      { key: 'def_blk_kick',  label: 'Blocked Punt/PAT/FG',   defaultValue: 2 },
      { key: 'def_blk_kick_td', label: 'Blocked Kick TD',     defaultValue: 6 },
      { key: 'def_td',        label: 'Defensive TD',           defaultValue: 6 },
      { key: 'def_st_td',     label: 'Special Teams TD',       defaultValue: 6 },
      { key: 'def_kr_td',     label: 'Kickoff Return TD',      defaultValue: 6 },
      { key: 'def_pr_td',     label: 'Punt Return TD',         defaultValue: 6 },
      { key: 'def_ff',        label: 'Fumble Forced',          defaultValue: 0 },
      { key: 'dst_pa0',       label: 'PA: 0 pts allowed',      defaultValue: 10 },
      { key: 'dst_pa1',       label: 'PA: 1-6 pts allowed',    defaultValue: 7 },
      { key: 'dst_pa7',       label: 'PA: 7-13 pts allowed',   defaultValue: 4 },
      { key: 'dst_pa14',      label: 'PA: 14-17 pts allowed',  defaultValue: 1 },
      { key: 'dst_pa18',      label: 'PA: 18-21 pts allowed',  defaultValue: 0 },
      { key: 'dst_pa22',      label: 'PA: 22-27 pts allowed',  defaultValue: 0 },
      { key: 'dst_pa28',      label: 'PA: 28-34 pts allowed',  defaultValue: -1 },
      { key: 'dst_pa35',      label: 'PA: 35-45 pts allowed',  defaultValue: -3 },
      { key: 'dst_pa46',      label: 'PA: 46+ pts allowed',    defaultValue: -5 },
      { key: 'dst_ya100',     label: 'YA: <100 yds allowed',   defaultValue: 0 },
      { key: 'dst_ya199',     label: 'YA: 100-199 yds',        defaultValue: 0 },
      { key: 'dst_ya299',     label: 'YA: 200-299 yds',        defaultValue: 0 },
      { key: 'dst_ya349',     label: 'YA: 300-349 yds',        defaultValue: 0 },
      { key: 'dst_ya399',     label: 'YA: 350-399 yds',        defaultValue: 0 },
      { key: 'dst_ya449',     label: 'YA: 400-449 yds',        defaultValue: 0 },
      { key: 'dst_ya499',     label: 'YA: 450-499 yds',        defaultValue: 0 },
      { key: 'dst_ya549',     label: 'YA: 500-549 yds',        defaultValue: 0 },
      { key: 'dst_ya550',     label: 'YA: 550+ yds',           defaultValue: 0 },
    ],
  },
  {
    id: 'misc',
    label: 'Miscellaneous',
    stats: [
      { key: 'fum',           label: 'Fumble',                 defaultValue: 0 },
      { key: 'fum_lost',      label: 'Fumble Lost',            defaultValue: -2 },
      { key: 'two_pt_ret',    label: '2pt Return',             defaultValue: 2 },
      { key: 'one_pt_sf',     label: '1pt Safety',             defaultValue: 1 },
    ],
  },
];

// Standard scoring presets
const PRESETS: Record<string, ScoringRules> = {
  standard: {
    pass_yd: 0.04, pass_td: 4, pass_int: -2, pass_2pt: 2,
    rush_yd: 0.1, rush_td: 6, rush_2pt: 2,
    rec_yd: 0.1, rec_td: 6, rec_2pt: 2,
    xpm: 1, fgmiss: -1, fg_0_19: 3, fg_20_29: 3, fg_30_39: 3, fg_40_49: 4, fg_50_59: 5, fg_60p: 5,
    def_sack: 1, def_int: 2, def_fum_rec: 2, def_safe: 2, def_blk_kick: 2, def_td: 6,
    dst_pa0: 10, dst_pa1: 7, dst_pa7: 4, dst_pa14: 1, dst_pa28: -1, dst_pa35: -3, dst_pa46: -5,
    fum_lost: -2,
  },
  ppr: {
    pass_yd: 0.04, pass_td: 4, pass_int: -2, pass_2pt: 2,
    rush_yd: 0.1, rush_td: 6, rush_2pt: 2,
    rec: 1, rec_yd: 0.1, rec_td: 6, rec_2pt: 2,
    xpm: 1, fgmiss: -1, fg_0_19: 3, fg_20_29: 3, fg_30_39: 3, fg_40_49: 4, fg_50_59: 5, fg_60p: 5,
    def_sack: 1, def_int: 2, def_fum_rec: 2, def_safe: 2, def_blk_kick: 2, def_td: 6,
    dst_pa0: 10, dst_pa1: 7, dst_pa7: 4, dst_pa14: 1, dst_pa28: -1, dst_pa35: -3, dst_pa46: -5,
    fum_lost: -2,
  },
  half_ppr: {
    pass_yd: 0.04, pass_td: 4, pass_int: -2, pass_2pt: 2,
    rush_yd: 0.1, rush_td: 6, rush_2pt: 2,
    rec: 0.5, rec_yd: 0.1, rec_td: 6, rec_2pt: 2,
    xpm: 1, fgmiss: -1, fg_0_19: 3, fg_20_29: 3, fg_30_39: 3, fg_40_49: 4, fg_50_59: 5, fg_60p: 5,
    def_sack: 1, def_int: 2, def_fum_rec: 2, def_safe: 2, def_blk_kick: 2, def_td: 6,
    dst_pa0: 10, dst_pa1: 7, dst_pa7: 4, dst_pa14: 1, dst_pa28: -1, dst_pa35: -3, dst_pa46: -5,
    fum_lost: -2,
  },
};

interface Props {
  rules: ScoringRules;
  onChange: (rules: ScoringRules) => void;
}

export default function ScoringRulesPanel({ rules, onChange }: Props) {
  const [expanded, setExpanded] = useState<Record<string, boolean>>({
    passing: true, rushing: true, receiving: true, kicking: false, dst: false, misc: false,
  });

  function toggleCategory(id: string) {
    setExpanded(prev => ({ ...prev, [id]: !prev[id] }));
  }

  function setValue(key: string, raw: string) {
    const num = raw === '' || raw === '-' ? 0 : parseFloat(raw);
    const next = { ...rules };
    if (!isNaN(num) && num !== 0) {
      next[key] = num;
    } else {
      delete next[key];
    }
    onChange(next);
  }

  function applyPreset(presetKey: string) {
    onChange({ ...PRESETS[presetKey] });
  }

  function activeCount(cat: Category) {
    return cat.stats.filter(s => rules[s.key] !== undefined && rules[s.key] !== 0).length;
  }

  return (
    <div>
      {/* Preset buttons */}
      <div style={{ marginBottom: '16px' }}>
        <div style={{ fontSize: '13px', color: '#6b7280', marginBottom: '8px', fontWeight: '500' }}>
          Quick presets
        </div>
        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
          {[
            { key: 'standard', label: 'Standard' },
            { key: 'ppr',      label: 'PPR' },
            { key: 'half_ppr', label: 'Half PPR' },
          ].map(({ key, label }) => (
            <button
              key={key}
              type="button"
              onClick={() => applyPreset(key)}
              style={{
                padding: '6px 14px', fontSize: '13px', fontWeight: '600',
                borderRadius: '6px', border: '1px solid #d1d5db',
                background: '#f9fafb', color: '#374151', cursor: 'pointer',
              }}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* Categories */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
        {CATEGORIES.map(cat => {
          const count = activeCount(cat);
          const isOpen = expanded[cat.id];
          return (
            <div key={cat.id} style={{ border: '1px solid #e5e7eb', borderRadius: '8px', overflow: 'hidden' }}>
              {/* Category header */}
              <button
                type="button"
                onClick={() => toggleCategory(cat.id)}
                style={{
                  width: '100%', display: 'flex', alignItems: 'center',
                  justifyContent: 'space-between', padding: '12px 16px',
                  background: '#f9fafb', border: 'none', cursor: 'pointer',
                  textAlign: 'left',
                }}
              >
                <span style={{ fontWeight: '600', fontSize: '15px', color: '#111827' }}>
                  {cat.label}
                </span>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                  {count > 0 && (
                    <span style={{
                      fontSize: '11px', fontWeight: '700', padding: '2px 7px',
                      background: '#dbeafe', color: '#1d4ed8', borderRadius: '10px',
                    }}>
                      {count} active
                    </span>
                  )}
                  <span style={{ color: '#9ca3af', fontSize: '12px' }}>{isOpen ? '▲' : '▼'}</span>
                </div>
              </button>

              {/* Stats grid */}
              {isOpen && (
                <div style={{ padding: '12px 16px', background: '#fff' }}>
                  <div style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
                    gap: '8px',
                  }}>
                    {cat.stats.map(stat => {
                      const val = rules[stat.key];
                      const isActive = val !== undefined && val !== 0;
                      return (
                        <div
                          key={stat.key}
                          style={{
                            display: 'flex', alignItems: 'center', gap: '10px',
                            padding: '8px 10px', borderRadius: '6px',
                            background: isActive ? '#f0fdf4' : '#fafafa',
                            border: `1px solid ${isActive ? '#86efac' : '#f3f4f6'}`,
                            transition: 'background 0.1s, border-color 0.1s',
                          }}
                        >
                          {/* Checkbox */}
                          <input
                            type="checkbox"
                            checked={isActive}
                            onChange={e => {
                              if (e.target.checked) {
                                onChange({ ...rules, [stat.key]: stat.defaultValue !== 0 ? stat.defaultValue : 1 });
                              } else {
                                const next = { ...rules };
                                delete next[stat.key];
                                onChange(next);
                              }
                            }}
                            style={{ flexShrink: 0, width: '16px', height: '16px', cursor: 'pointer', accentColor: '#2563eb' }}
                          />
                          {/* Label */}
                          <span style={{
                            flex: 1, fontSize: '13px', color: '#374151',
                            minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                          }}>
                            {stat.label}
                          </span>
                          {/* Points input */}
                          <input
                            type="number"
                            step="0.01"
                            value={val ?? ''}
                            placeholder="0"
                            onChange={e => setValue(stat.key, e.target.value)}
                            onFocus={e => {
                              if (!isActive) {
                                onChange({ ...rules, [stat.key]: stat.defaultValue !== 0 ? stat.defaultValue : 1 });
                                e.target.value = String(stat.defaultValue !== 0 ? stat.defaultValue : 1);
                              }
                            }}
                            style={{
                              width: '64px', flexShrink: 0,
                              padding: '4px 6px', fontSize: '13px', fontWeight: '600',
                              border: `1px solid ${isActive ? '#86efac' : '#d1d5db'}`,
                              borderRadius: '5px', background: isActive ? '#fff' : '#f9fafb',
                              color: (val ?? 0) < 0 ? '#dc2626' : '#111827',
                              textAlign: 'right', boxSizing: 'border-box',
                            }}
                          />
                          <span style={{ fontSize: '11px', color: '#9ca3af', flexShrink: 0 }}>pts</span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
