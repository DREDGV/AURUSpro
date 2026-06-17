import sys
sys.path.insert(0, '.')
from aurus import app

with app.test_client() as c:
    r = c.post('/register', data={'username': 'DREDGV', 'password': 'aurus2019'}, follow_redirects=True)
    r = c.post('/login', data={'username': 'DREDGV', 'password': 'aurus2019'}, follow_redirects=True)
    
    r = c.get('/dashboard')
    print('Dashboard:', r.status_code, 'len=', len(r.data))
    
    r = c.get('/players')
    print('Players:', r.status_code, 'len=', len(r.data))
    
    r = c.get('/accounts')
    print('Accounts:', r.status_code, 'len=', len(r.data))
    
    r = c.get('/fleet')
    print('Fleet:', r.status_code, 'len=', len(r.data))
    
    r = c.get('/objects')
    print('Objects:', r.status_code, 'len=', len(r.data))
    
    r = c.get('/tasks')
    print('Tasks:', r.status_code, 'len=', len(r.data))
    
    r = c.get('/questionnaires')
    print('Questionnaires:', r.status_code, 'len=', len(r.data))
    
    r = c.get('/admin/roles')
    print('Admin roles:', r.status_code, 'len=', len(r.data))
    
    r = c.get('/export')
    print('Export:', r.status_code, 'len=', len(r.data))
    
    r = c.get('/players/1')
    print('Player card:', r.status_code, 'len=', len(r.data))
    
    print('ALL OK')
