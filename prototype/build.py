# Rebuilds slicefield.html from src/. The whole instrument is one class, Slicefield, the page's only
# global: the engine, the loop generators, the interface code and its markup are static members, and
# each instance draws into its own shadow root (so its styles and element ids never touch the host page).
import pathlib,json
d=pathlib.Path(__file__).parent/'src'
rd=lambda f:(d/f).read_text().strip()
out=(rd('page.html')+'\n<script>\nclass Slicefield{\n'
  '/*ENGINE START*/\nstatic engineFactory='+rd('engine.js')+';\n/*ENGINE END*/\n'
  '/*SYNTH START*/\nstatic synthFactory='+rd('synth.js').split('\n',1)[1]+';\n/*SYNTH END*/\n'
  'static markup='+json.dumps(rd('app.html'))+';\n'
  'static ui='+rd('ui.js')+';\n'
  'constructor(host){Slicefield.ui.call(this,host,Slicefield.engineFactory,Slicefield.synthFactory(),Slicefield.markup);}\n'
  '}\nnew Slicefield(document.getElementById(\'slicefield\'));\n</script>\n')
(pathlib.Path(__file__).parent/'slicefield.html').write_text(out)
print('wrote slicefield.html',len(out))
