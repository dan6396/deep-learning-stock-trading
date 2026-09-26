import unittest

import numpy as np
import pandas as pd
from scipy.sparse import csr_matrix

from news_fusion.residual import forecast_day, residual_predict
from run_news_residual_research import text_for_day
from run_news_orthogonal import branch_prediction


class ResidualTests(unittest.TestCase):
    def test_forecasts_invariant_to_current_and_future_outcomes(self):
        rng=np.random.default_rng(42)
        dates=pd.bdate_range('2025-01-01',periods=13)
        frame=pd.DataFrame([{'date':d-pd.Timedelta(days=1),'entry_date':d,
                             'ticker':str(i),'huber_ensemble':i/20,
                             'price_rank':(i+1)/20,'target_rank':rng.random()}
                            for d in dates for i in range(20)])
        matrices={'news':csr_matrix(rng.normal(size=(len(frame),4)))}
        date=dates[10]
        before,audit=forecast_day(frame,matrices,date)
        changed=frame.copy()
        changed.loc[changed.entry_date>=date,'target_rank']=np.nan
        altered_matrix=matrices['news'].toarray()
        altered_matrix[(frame.entry_date>date).to_numpy()]=99999.
        after,audit_after=forecast_day(changed,{'news':csr_matrix(altered_matrix)},date)
        pd.testing.assert_frame_equal(before,after)
        self.assertEqual(audit,audit_after)

    def test_no_news_means_zero_correction(self):
        x=csr_matrix([[1.,0.],[0.,1.],[1.,1.],[0.,0.]])
        result=residual_predict(x,[.3,-.2,.1,999.],np.array([0,1,2]),np.array([3]),1.)
        self.assertEqual(float(result[0]),0.)

    def test_return_residual_does_not_read_future_returns(self):
        rng=np.random.default_rng(123)
        frame=pd.DataFrame({'entry_date':np.repeat(pd.bdate_range('2025-01-01',periods=4),10),
                            'huber_ensemble':rng.normal(0,.01,40),
                            'actual_oc':rng.normal(0,.02,40)})
        x=csr_matrix(rng.normal(size=(40,3)))
        fit=np.arange(20);test=np.arange(20,30)
        before=branch_prediction(frame,x,fit,test,10.)
        frame.loc[20:,'actual_oc']=np.nan
        after=branch_prediction(frame,x,fit,test,10.)
        for a,b in zip(before,after):np.testing.assert_array_equal(a,b)

    def test_same_day_and_known_later_revision_excluded(self):
        def article(id,day,modified=None):
            return {'article_id':id,'title':id,'published_at':day,'modified_at':modified}
        articles=[article('yesterday','2026-06-02T23:59:00+09:00'),
                  article('today','2026-06-03T01:00:00+09:00'),
                  article('too_old','2026-05-30T12:00:00+09:00'),
                  article('revised','2026-06-02T12:00:00+09:00','2026-06-04T12:00:00+09:00')]
        text,ids=text_for_day(articles,'2026-06-03')
        self.assertEqual(ids,['yesterday'])

    def test_repeated_titles_not_multiple_votes(self):
        articles=[{'article_id':str(i),'title':'같은 뉴스','published_at':f'2026-06-0{i}T12:00:00+09:00'} for i in [1,2]]
        text,ids=text_for_day(articles,'2026-06-03')
        self.assertEqual(len(ids),1)


if __name__=='__main__':unittest.main()
