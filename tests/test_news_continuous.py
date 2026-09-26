import unittest
import numpy as np
import pandas as pd
from scipy.sparse import csr_matrix

from run_news_continuous_models import predict,is_event


class ContinuousNewsTests(unittest.TestCase):
    def test_future_outcomes_do_not_change_ridge_or_tree(self):
        rng=np.random.default_rng(77)
        frame=pd.DataFrame({'entry_date':np.repeat(pd.bdate_range('2026-06-01',periods=8),50),
                            'huber_ensemble':rng.normal(0,.01,400),'actual_oc':rng.normal(0,.02,400)})
        x=rng.normal(size=(400,4));fit=np.arange(300);test=np.arange(300,350)
        for tree in [False,True]:
            matrix=x if tree else csr_matrix(x)
            before=predict(frame,matrix,fit,test,10.,tree=tree)
            changed=frame.copy();changed.loc[300:,'actual_oc']=np.nan
            after=predict(changed,matrix,fit,test,10.,tree=tree)
            for a,b in zip(before,after):np.testing.assert_array_equal(a,b)

    def test_no_news_gives_zero_linear_overlay(self):
        rng=np.random.default_rng(2)
        f=pd.DataFrame({'entry_date':np.repeat(pd.bdate_range('2026-06-01',periods=3),10),
                        'huber_ensemble':rng.normal(size=30),'actual_oc':rng.normal(size=30)*.01})
        matrix=csr_matrix(np.r_[np.ones((20,2)),np.zeros((10,2))])
        _,delta=predict(f,matrix,np.arange(20),np.arange(20,30),10.)
        np.testing.assert_array_equal(delta,np.zeros(10))

    def test_event_screen_does_not_treat_sports_as_business(self):
        self.assertFalse(is_event('한국가스공사 프로농구 선수 계약 체결'))
        self.assertTrue(is_event('삼성전자 잠정실적 영업이익 발표'))


if __name__=='__main__':unittest.main()
