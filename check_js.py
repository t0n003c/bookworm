files=[
    'static/js/home-widgets.js',
    'static/js/home-widgets-render.js',
    'static/js/home-widgets-clock.js',
    'static/js/home-widget-text.js',
    'static/js/home-widget-text-fmt.js',
    'static/js/home-widgets-settings.js',
]
for f in files:
    src=open(f,encoding='utf-8').read()
    o=src.count('{')
    c=src.count('}')
    print(f, '|', o, 'opens', c, 'closes', '| diff =', o-c)
