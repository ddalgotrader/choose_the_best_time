#Code to create interactive dashboard. If you wan to serve it on Github Pages visit https://towardsdatascience.com/how-to-deploy-a-panel-visualization-dashboard-to-github-pages-2f520fd8660


import pandas as pd

import panel as pn


pn.extension(sizing_mode='stretch_width')
prices_df=pd.read_csv('/path/to/file/prices_spreads.csv', parse_dates=['Date'], index_col='Date')
prices_df = prices_df.loc[:, prices_df.columns!='weekday']

currencies = list(filter(lambda col: 'spread' not in col, prices_df.columns))
symbol = pn.widgets.Select(name='currency', options=sorted(currencies))
freq = pn.widgets.Select(name='frequency', options=['1min', '5min', '10min', '15min', '20min', '30min', '45min', '1H'])


@pn.depends(symbol.param.value, freq.param.value)
def plot_cover_chart(symbol, freq):
    df_cur = pd.DataFrame(prices_df.loc[:, [symbol, f'{symbol}_spread']])
    df_cur = df_cur.resample(freq).last().dropna()
    df_cur['price_diff'] = round(df_cur[symbol].diff().abs(), 5)
    df_cur["hour"] = df_cur.index.hour
    df_cur['covered'] = df_cur['price_diff'] > df_cur[f'{symbol}_spread']
    data_to_plot = df_cur.dropna().groupby("hour").covered.mean()
    df_to_plot = pd.DataFrame(data_to_plot).reset_index()
    df_to_plot['covered']=df_to_plot['covered']*100
    df_to_plot['not_covered'] = 100 - df_to_plot['covered']
    return df_to_plot.hvplot.bar(x='hour', y=['covered', 'not_covered'], stacked=True, color=['green', 'red'],
                                 legend='top', ylabel='% of covered spread')




symbol.servable()
freq.servable()


pn.panel(pn.bind(plot_cover_chart, symbol, freq), height=400).servable(title='Comparison of cover spreads')

