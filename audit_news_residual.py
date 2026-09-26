"""Artifact-level checks for chronological fits, article membership and replay parity."""
from pathlib import Path
import json

import numpy as np
import pandas as pd

from run_news_residual_corrected import OUT,PREVIOUS,OLD
from run_news_residual_research import sha,read
from news_fusion.news import save_json,now
from run_news_orthogonal import OUT as RETURN


def audit():
    checked=0
    for root in [PREVIOUS,OUT]:
        for path,expected in read(root/'protocol.json')['source_hashes'].items():
            assert sha(path)==expected, f'Changed source: {path}'
            checked+=1
    requests={(r['entry_date'],r['ticker'],r['parent_article_id']) for r in read(OLD/'article_requests.json')}
    parents={a['article_id']:a['parent_article_id'] for a in read(OLD/'body_articles.json')}
    slots=0
    for row in read(OUT/'article_membership.json'):
        for id in row['body_ids']:
            assert (row['entry_date'],row['ticker'],parents[id]) in requests
            slots+=1
    for row in read(OUT/'choices.json'):
        if row['branch']=='selected_news':continue
        assert row['fit_last_date']<row['validation_first']<=row['refit_last_date']<row['forecast_date']
    assert sha(OUT/'frozen_forecasts.parquet')==read(OUT/'score_audit.json')['sha256']
    current=pd.read_csv(OUT/'metrics.csv')
    prior=pd.read_csv(PREVIOUS/'metrics.csv')
    a=current[current.strategy=='price_rank'].set_index('block').final_equity
    b=prior[prior.strategy=='price_rank'].set_index('block').final_equity
    assert np.allclose(a,b,rtol=0,atol=1e-6)
    assert current.independent_ledger_max_error.max()<1e-6
    # Zero September body coverage must not silently become a news success.
    f=pd.read_parquet(OUT/'frozen_forecasts.parquet')
    sept=f[f.entry_date>='2026-09-01']
    for name in ['body_e5_fixed','body_e5_adaptive','body_tfidf_fixed','body_tfidf_adaptive']:
        assert np.array_equal(sept[name],sept.price_rank)
    record={'at':now(),'frozen_sources_verified':checked,'same_date_body_slots_verified':slots,
            'chronological_fits':'passed','baseline_replay_parity':'passed',
            'independent_ledger_max_error':float(current.independent_ledger_max_error.max()),
            'september_body_fallback':'exactly price baseline'}
    save_json(OUT/'integrity_audit.json',record)
    for path,expected in read(RETURN/'protocol.json')['source_hashes'].items():
        assert sha(path)==expected,path
    assert sha(RETURN/'frozen_forecasts.parquet')==read(RETURN/'score_audit.json')['sha256']
    for row in read(RETURN/'choices.json'):
        if row['branch']=='selected_news':continue
        assert row['fit_last_date']<row['validation_first']<=row['refit_last_date']<row['forecast_date']
    ret=pd.read_csv(RETURN/'metrics.csv')
    c=ret[ret.strategy=='price_rank'].set_index('block').final_equity
    assert np.allclose(a,c,rtol=0,atol=1e-6)
    assert ret.independent_ledger_max_error.max()<1e-6
    save_json(RETURN/'integrity_audit.json',{'frozen_sources':'passed','chronology':'passed',
                                          'baseline_replay_parity':'passed','ledger':'passed'})
    print(json.dumps(record,ensure_ascii=False,indent=2))


if __name__=='__main__':audit()
