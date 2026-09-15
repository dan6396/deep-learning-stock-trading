"""Equal cash allocation to new candidates; fractional shares for strategy comparison."""
import numpy as np
import pandas as pd

def simulate(signals,bars,capital=10_000_000,cost=.00125):
    prices=bars.set_index(['date','ticker']);held={};cash=float(capital);previous=float(capital)
    daily=[];orders=[];holdings=[];dates=sorted(signals.entry_date.unique())
    for i,date in enumerate(dates):
        date=pd.Timestamp(date)
        g=signals[signals.entry_date==date].sort_values(['huber_ensemble','ticker'],ascending=[False,True])
        assert len(g)==5 and (g.date<date).all()
        desired=list(g.ticker);fees=0.;overnight=0.;intraday=0.
        def price(ticker,col):
            x=float(prices.loc[(date,ticker),col])
            assert np.isfinite(x) and x>0 and prices.loc[(date,ticker),'Volume']>0
            return x
        overnight=cash+sum(q*price(t,'Open') for t,q in held.items())-previous
        def trade(ticker,side,q,p,phase,reason):
            nonlocal cash,fees
            amount=q*p;fee=amount*cost
            cash+=amount-fee if side=='sell' else -amount-fee
            fees+=fee
            assert cash>=-1e-6
            orders.append({'date':date,'ticker':ticker,'side':side,'quantity':q,'price':p,'notional':amount,'fee':fee,'cash_after_order':cash,'phase':phase,'reason':reason})
        for ticker in sorted(set(held)-set(desired)):
            trade(ticker,'sell',held.pop(ticker),price(ticker,'Open'),'open','left_top5')
        retained=len(held);missing=[t for t in desired if t not in held]
        budget=cash/len(missing) if missing else 0.
        for ticker in missing:
            p=price(ticker,'Open');q=budget/(p*(1+cost))
            assert q>0
            trade(ticker,'buy',q,p,'open','initial_entry' if i==0 else 'new_top5_member')
            held[ticker]=q
        assert set(held)==set(desired) and len(held)==5
        intraday=sum(q*(price(t,'Close')-price(t,'Open')) for t,q in held.items())
        for t,q in held.items():holdings.append({'date':date,'ticker':t,'quantity':q,'close_price':price(t,'Close')})
        if i==len(dates)-1:
            for ticker in sorted(list(held)):
                trade(ticker,'sell',held.pop(ticker),price(ticker,'Close'),'close','terminal_liquidation')
        equity=cash+sum(q*price(t,'Close') for t,q in held.items())
        assert abs(equity-previous-overnight-intraday+fees)<1e-6
        daily.append({'date':date,'start_equity':previous,'end_equity':equity,'net_pnl':equity-previous,'overnight_pnl':overnight,'intraday_pnl':intraday,'fees':fees,'retained_positions':retained,'close_cash':cash})
        previous=equity
    d=pd.DataFrame(daily);t=pd.DataFrame(orders)
    # Replay independent cash and inventory from the order ledger.
    money=float(capital);inventory={};errors=[]
    for day in d.itertuples():
        for order in t[t.date==day.date].itertuples():
            assert abs(order.notional-order.quantity*order.price)<1e-7
            assert abs(order.fee-order.notional*cost)<1e-7
            if order.side=='buy':
                inventory[order.ticker]=inventory.get(order.ticker,0.)+order.quantity
                money-=order.notional+order.fee
            else:
                assert abs(inventory.pop(order.ticker)-order.quantity)<1e-10
                money+=order.notional-order.fee
            assert abs(money-order.cash_after_order)<1e-6
        eq=money+sum(q*float(prices.loc[(day.date,ticker),'Close']) for ticker,q in inventory.items())
        errors.append(abs(eq-day.end_equity))
    assert max(errors)<1e-6 and not inventory
    eq=np.r_[capital,d.end_equity.to_numpy()];peak=np.maximum.accumulate(eq)
    met={'initial_capital':capital,'final_equity':float(eq[-1]),'net_profit':float(eq[-1]-capital),'net_return':float(eq[-1]/capital-1),
         'mdd':float((eq/peak-1).min()),'total_fees':float(d.fees.sum()),'buy_orders':int((t.side=='buy').sum()),'sell_orders':int((t.side=='sell').sum()),
         'overnight_pnl':float(d.overnight_pnl.sum()),'intraday_pnl':float(d.intraday_pnl.sum()),'days':len(d),'independent_ledger_max_error':max(errors)}
    return met,d,t,pd.DataFrame(holdings)

def self_check():
    dates=pd.bdate_range('2024-01-01',periods=3)
    s=pd.DataFrame([{'date':d-pd.Timedelta(days=1),'entry_date':d,'ticker':str(i),'huber_ensemble':6-i} for d in dates for i in range(5)])
    b=pd.DataFrame([{'date':d,'ticker':str(i),'Open':100,'Close':100,'Volume':1000} for d in dates for i in range(6)])
    m,d,t,h=simulate(s,b,1000,.01)
    assert abs(m['final_equity']-1000*.99/1.01)<1e-7 and len(t)==10
    r=s.copy();r.loc[(r.entry_date>dates[0])&(r.ticker=='0'),'ticker']='5'
    m,d,t,h=simulate(r,b,1000,0)
    assert abs(m['final_equity']-1000)<1e-7 and len(t)==12
    b.loc[b.date>dates[0],['Open','Close']]=110
    m,d,t,h=simulate(s,b,1000,0)
    assert abs(m['final_equity']-1100)<1e-7 and abs(m['overnight_pnl']-100)<1e-7
