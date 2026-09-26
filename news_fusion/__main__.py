"""python -m news_fusion --help"""
import argparse
import json
from pathlib import Path
import pandas as pd
from .news import collect_google_rss,deduplicate,save_json
from .gemini import GeminiExtractor,load_key,PROMPT_VERSION
from .fusion import build_features,fit_fusion,score_and_select,replay_selection,import_step2

def read_json(path):return json.loads(Path(path).read_text(encoding='utf-8'))

def main():
    parser=argparse.ArgumentParser(description='Auditable news extraction and deterministic Huber fusion')
    sub=parser.add_subparsers(dest='command',required=True)
    p=sub.add_parser('collect');p.add_argument('--companies',required=True,help='JSON {ticker:company name}')
    p.add_argument('--start',required=True);p.add_argument('--end',required=True,help='Exclusive end date')
    p.add_argument('--out',required=True);p.add_argument('--window-days',type=int,default=7)
    p=sub.add_parser('extract');p.add_argument('--articles',required=True);p.add_argument('--out',required=True)
    p.add_argument('--env-file',default='.env.news_fusion');p.add_argument('--model',default='gemini-2.5-flash-lite')
    p.add_argument('--max-calls',type=int,default=3);p.add_argument('--interval',type=float,default=7)
    p=sub.add_parser('bodies');p.add_argument('--articles',required=True);p.add_argument('--out',required=True)
    p.add_argument('--limit',type=int,default=12);p.add_argument('--resolved-urls',help='Optional saved URL resolution records')
    p=sub.add_parser('features');p.add_argument('--predictions',required=True);p.add_argument('--articles',required=True)
    p.add_argument('--extractions',required=True);p.add_argument('--out',required=True)
    p.add_argument('--mode',choices=['strict','exploratory'],default='strict');p.add_argument('--cutoff',default='08:30')
    p.add_argument('--entry-date',help='Required when importing integrated_pipeline STEP2 CSV')
    p=sub.add_parser('fit');p.add_argument('--features',required=True);p.add_argument('--train-end',required=True)
    p.add_argument('--validation-end',required=True);p.add_argument('--out',required=True)
    p=sub.add_parser('select');p.add_argument('--features',required=True);p.add_argument('--model');p.add_argument('--out',required=True)
    p.add_argument('--pool-size',type=int,default=20)
    p=sub.add_parser('replay');p.add_argument('--selection',required=True);p.add_argument('--bars',required=True);p.add_argument('--out',required=True)
    a=parser.parse_args();out=Path(a.out);out.mkdir(parents=True,exist_ok=True)
    if a.command=='collect':
        if not 1<=a.window_days<=31:raise ValueError('Window must be 1..31 days')
        articles=[];queries=[]
        for ticker,company in read_json(a.companies).items():
            start=pd.Timestamp(a.start);end=pd.Timestamp(a.end)
            while start<end:
                stop=min(end,start+pd.Timedelta(days=a.window_days))
                try:
                    r=collect_google_rss(company,ticker,str(start.date()),str(stop.date()),out/'rss_cache')
                    articles.extend(r['articles']);queries.append({k:v for k,v in r.items() if k!='articles'})
                    print(company,str(start.date()),r['retained_count'],flush=True)
                except Exception as exc:
                    queries.append({'company':company,'start':str(start.date()),'error':type(exc).__name__})
                save_json(out/'articles.json',deduplicate(articles));save_json(out/'collection_audit.json',queries)
                start=stop
    elif a.command=='bodies':
        from .body import fetch_article_body
        if a.limit<1:raise ValueError('--limit must be positive')
        resolved={r['article_id']:r['decoded_url'] for r in read_json(a.resolved_urls) if r.get('success')} if a.resolved_urls else {}
        records=[]
        for article in read_json(a.articles)[:a.limit]:
            record=fetch_article_body(article,out/'body_cache',resolved.get(article['article_id']))
            records.append(record)
            save_json(out/'body_audit.json',records)
            save_json(out/'body_articles.json',[r['article'] for r in records if r['status']=='body_extracted'])
            print(article['ticker'],record['status'],record.get('body_chars',0),record.get('failure_reason',''),flush=True)
    elif a.command=='extract':
        extractor=GeminiExtractor(load_key(a.env_file),out/'gemini_cache',a.model,a.max_calls,a.interval)
        dest=out/'extractions.json'; records=read_json(dest) if dest.exists() else []
        if any(r['model']!=extractor.model or r['prompt_version']!=PROMPT_VERSION for r in records):
            raise ValueError('Output has another extractor version; use a new output directory')
        done={r['article_id'] for r in records}
        for article in read_json(a.articles):
            if article['article_id'] in done:continue
            try: records.append(extractor.extract(article));save_json(dest,records)
            except RuntimeError as exc:
                save_json(out/'extraction_status.json',{'status':'stopped','reason':str(exc),'calls_this_run':extractor.calls,'completed':len(records)})
                print(str(exc));return
        save_json(out/'extraction_status.json',{'status':'complete','calls_this_run':extractor.calls,'completed':len(records)})
    elif a.command=='features':
        if Path(a.predictions).suffix.lower()=='.csv':
            if not a.entry_date:raise ValueError('--entry-date is required for STEP2 CSV')
            prices=import_step2(pd.read_csv(a.predictions,dtype={'ticker':str}),a.entry_date)
        else:prices=pd.read_parquet(a.predictions)
        f=build_features(prices,read_json(a.articles),read_json(a.extractions),a.mode,a.cutoff)
        f.to_parquet(out/'features.parquet',index=False)
    elif a.command=='fit':
        save_json(out/'model.json',fit_fusion(pd.read_parquet(a.features),a.train_end,a.validation_end))
    elif a.command=='select':
        s=score_and_select(pd.read_parquet(a.features),read_json(a.model) if a.model else None,a.pool_size)
        s.to_parquet(out/'selection.parquet',index=False);s.to_csv(out/'selection.csv',index=False,encoding='utf-8-sig')
    elif a.command=='replay':
        s=pd.read_parquet(a.selection)
        if s.selection_model.eq('fitted_linear_fusion').any() and (s.unprocessed_articles.gt(0).any() or s.usable_articles.sum()==0):
            raise ValueError('Refusing incomplete news-enhanced replay; finish extraction first')
        m,d,t,h=replay_selection(s,pd.read_parquet(a.bars))
        m.update(selection_model=str(s.selection_model.iloc[0]),availability_mode=str(s.availability_mode.iloc[0]))
        save_json(out/'metrics.json',m)
        for name,frame in [('daily',d),('trades',t),('holdings',h)]:frame.to_parquet(out/(name+'.parquet'),index=False)
        print(json.dumps(m,ensure_ascii=False))

if __name__=='__main__':main()
