importScripts("https://cdn.jsdelivr.net/pyodide/v0.22.1/full/pyodide.js");

function sendPatch(patch, buffers, msg_id) {
  self.postMessage({
    type: 'patch',
    patch: patch,
    buffers: buffers
  })
}

async function startApplication() {
  console.log("Loading pyodide!");
  self.postMessage({type: 'status', msg: 'Loading pyodide'})
  self.pyodide = await loadPyodide();
  self.pyodide.globals.set("sendPatch", sendPatch);
  console.log("Loaded!");
  await self.pyodide.loadPackage("micropip");
  const env_spec = ['https://cdn.holoviz.org/panel/0.14.4/dist/wheels/bokeh-2.4.3-py3-none-any.whl', 'https://cdn.holoviz.org/panel/0.14.4/dist/wheels/panel-0.14.4-py3-none-any.whl', 'pyodide-http==0.1.0', 'holoviews>=1.15.4', 'hvplot', 'io', 'pandas']
  for (const pkg of env_spec) {
    let pkg_name;
    if (pkg.endsWith('.whl')) {
      pkg_name = pkg.split('/').slice(-1)[0].split('-')[0]
    } else {
      pkg_name = pkg
    }
    self.postMessage({type: 'status', msg: `Installing ${pkg_name}`})
    try {
      await self.pyodide.runPythonAsync(`
        import micropip
        await micropip.install('${pkg}');
      `);
    } catch(e) {
      console.log(e)
      self.postMessage({
	type: 'status',
	msg: `Error while installing ${pkg_name}`
      });
    }
  }

  response = await fetch(
    "https://raw.githubusercontent.com/ddalgotrader/choose_the_best_time/main/prices_spreads.csv"
  );
  response.ok && response.status === 200
    ? (spreads = await response.text())
    : (spreads = "");
  // define global variable called titles to make it accessible by Python
  self.pyodide.globals.set("spreads_prices_CSV", spreads);

  console.log("Packages loaded!");
  self.postMessage({type: 'status', msg: 'Executing code'})
  const code = `
  
import asyncio

from panel.io.pyodide import init_doc, write_doc

init_doc()

import pandas as pd

import panel as pn
import hvplot.pandas
import io

csv_buffer = io.StringIO(spreads_prices_CSV)
prices_df=pd.read_csv(csv_buffer, parse_dates=['Date'], index_col='Date')
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
    df_to_plot['not_covered'] = 1 - df_to_plot['covered']
    return df_to_plot.hvplot.bar(x='hour', y=['covered', 'not_covered'], stacked=True, color=['green', 'red'],
                                 width=800, legend='top', ylabel='% of covered spread')


pn.Row(pn.WidgetBox(symbol, freq), width=300)
pn.Row(plot_cover_chart, background='WhiteSmoke')

symbol.servable()
freq.servable()

pn.panel(pn.bind(plot_cover_chart, symbol, freq), width=800, height=400).servable(title='Comparison of cover spreads')


await write_doc()
  `

  try {
    const [docs_json, render_items, root_ids] = await self.pyodide.runPythonAsync(code)
    self.postMessage({
      type: 'render',
      docs_json: docs_json,
      render_items: render_items,
      root_ids: root_ids
    })
  } catch(e) {
    const traceback = `${e}`
    const tblines = traceback.split('\n')
    self.postMessage({
      type: 'status',
      msg: tblines[tblines.length-2]
    });
    throw e
  }
}

self.onmessage = async (event) => {
  const msg = event.data
  if (msg.type === 'rendered') {
    self.pyodide.runPythonAsync(`
    from panel.io.state import state
    from panel.io.pyodide import _link_docs_worker

    _link_docs_worker(state.curdoc, sendPatch, setter='js')
    `)
  } else if (msg.type === 'patch') {
    self.pyodide.runPythonAsync(`
    import json

    state.curdoc.apply_json_patch(json.loads('${msg.patch}'), setter='js')
    `)
    self.postMessage({type: 'idle'})
  } else if (msg.type === 'location') {
    self.pyodide.runPythonAsync(`
    import json
    from panel.io.state import state
    from panel.util import edit_readonly
    if state.location:
        loc_data = json.loads("""${msg.location}""")
        with edit_readonly(state.location):
            state.location.param.update({
                k: v for k, v in loc_data.items() if k in state.location.param
            })
    `)
  }
}

startApplication()