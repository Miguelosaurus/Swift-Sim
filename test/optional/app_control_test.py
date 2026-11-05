import importlib.util
import hashlib
import http.server
import threading
import json
import os
from pathlib import Path
import stat
import tempfile
import time
import unittest
from unittest.mock import patch

source = Path(__file__).resolve().parents[2] / 'mac-helper/optional/app-control/control.py'
spec = importlib.util.spec_from_file_location('control', source)
c = importlib.util.module_from_spec(spec); spec.loader.exec_module(c)
APP = 'dev.example.fixture'
CAPS = ['envelope_v1', 'remote_ui', 'find_element_ref', 'stop_server']

class Fake:
    def __init__(self):
        self.calls = []; self.front = APP; self.device = 'fixture-phone'; self.version = c.VERSION
        self.text = 'TextField, value: empty'; self.broken = None; self.capture_scope = 'app'; self.source_app = APP
        self.locked = False
        self.caps = list(CAPS); self.lifetime = 480; self.duration = 600
    def call(self, method, params=None):
        params = params or {}; self.calls.append((method, params))
        if method == self.broken: raise RuntimeError('SECRET provider failure must not escape')
        if method == 'device_info': return {'server_version':self.version,'protocol_version':1,'device_id':self.device,
            'capabilities':self.caps,'point_width':390,'point_height':844,'system':{'screen_locked':self.locked,'foreground_app':self.front},
            'swift_sim_lifetime':{'maximum_seconds':3600 if self.version==c.BOUNDED_VERSION else 600,'duration_seconds':self.duration,'seconds_remaining':self.lifetime}}
        if method == 'activate_app': return {'foreground_app':self.front}
        if method == 'page_source': return {'bundle_id':self.source_app,'source':self.text,'keyboard':{'visible':False},'channel':{'recommended':'tree'}}
        if method == 'find_element': return {'exists':True,'hittable':True,'ref':'app-bound-reference'}
        if method == 'screenshot': return {'scope':self.capture_scope,'scoped_to':APP,'data':'/9j/2Q==','scale':1}
        if method in ['tap','type','swipe']: self.text='TextField, value: changed'; return {'message':'sent'}
        return {}

class ControlTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(); self.base = Path(self.tmp.name).resolve(); self.root = self.base/'optional'
        self.fake = Fake(); self.key = 'ab'*32
        self.store = self.base/'import.json'
        self.store.write_text(json.dumps({'100.64.0.2:8200':{'key':self.key,'tok':hashlib.sha256(bytes.fromhex(self.key)).digest()[:4].hex()},
            'other-phone':{'key':'do-not-import'}})); self.store.chmod(0o600)
    def tearDown(self): self.tmp.cleanup()
    def run_control(self, *args): return c.execute(list(args),self.root,lambda *_:self.fake)
    def configure(self): return self.run_control('configure','--host','100.64.0.2','--key-file',str(self.store),'--device-id','fixture-phone')
    def opened(self): self.configure(); return self.run_control('open','--app',APP)
    def code(self, code, fn):
        with self.assertRaises(c.ControlError) as raised: fn()
        self.assertEqual(raised.exception.code,code)
    def test_disabled_status_makes_no_files_or_network_requests(self):
        self.assertEqual(self.run_control('status')['outcome'],'disabled'); self.assertFalse(self.root.exists()); self.assertEqual(self.fake.calls,[])
    def test_only_private_selected_credentials_imported(self):
        self.configure(); records=c.private_read(self.root/'credentials.json')
        self.assertEqual(list(records),['swift-sim']); self.assertNotIn('do-not-import',json.dumps(records))
        self.assertEqual(stat.S_IMODE(self.root.stat().st_mode),0o700)
        for name in ['profile.json','credentials.json','operation.lock']:self.assertEqual(stat.S_IMODE((self.root/name).stat().st_mode),0o600)
    def test_explicit_check_authenticates_without_ui_or_session(self):
        self.configure();self.fake.calls=[]
        result=self.run_control('check')
        self.assertEqual(result['outcome'],'ready');self.assertFalse(result['inputAuthorized'])
        self.assertEqual([m for m,_ in self.fake.calls],['device_info'])
        self.assertFalse((self.root/'session.json').exists())

    def request(self):
        self.configure();self.fake.version=c.BOUNDED_VERSION;self.fake.caps.extend(['swift_sim_lifetime_v1','swift_sim_duration_v1'])
        c.private_write(self.root/'installation.json',{'version':c.BOUNDED_VERSION})
        value=self.run_control('request-create','--app',APP,'--name','Fixture','--authority','a'*64,'--audience','00000000-0000-4000-8000-000000000001')
        self.fake.calls=[]
        return value['request']['id']

    def test_request_requires_exact_phone_approval_before_any_app_input(self):
        request=self.request()
        self.code('APPROVAL_REQUIRED',lambda:self.run_control('open','--app',APP,'--request',request,'--authority','a'*64))
        self.assertNotIn('activate_app',[m for m,_ in self.fake.calls])
        self.code('REQUEST_REQUIRED',lambda:self.run_control('request-approve','--request',request,'--authority','a'*64,'--audience','another-phone'))
        self.run_control('request-approve','--request',request,'--authority','a'*64,'--audience','00000000-0000-4000-8000-000000000001')
        before=c.private_read(self.root/'request.json')['expiresAt']
        self.run_control('request-approve','--request',request,'--authority','a'*64,'--audience','00000000-0000-4000-8000-000000000001')
        self.assertEqual(c.private_read(self.root/'request.json')['expiresAt'],before)
        opened=self.run_control('open','--app',APP,'--request',request,'--authority','a'*64)
        self.assertEqual(c.private_read(self.root/'request.json')['state'],'consumed')
        self.assertEqual(c.private_read(self.root/'session.json')['request'],request)
        replay=self.run_control('request-approve','--request',request,'--authority','a'*64,'--audience','00000000-0000-4000-8000-000000000001')
        self.assertEqual(replay['outcome'],'request-consumed')
        with patch.object(c.socket,'create_connection',side_effect=ConnectionRefusedError):self.run_control('close','--session',opened['session'])
        self.assertEqual(self.run_control('request-get','--request',request,'--authority','a'*64)['outcome'],'request-closed')
        self.assertEqual(self.run_control('request-cancel','--request',request,'--authority','a'*64)['outcome'],'request-cancelled')

    def test_expiry_wrong_pairing_and_other_app_invalidate_request(self):
        request=self.request()
        self.code('REQUEST_REQUIRED',lambda:self.run_control('request-get','--request',request,'--authority','b'*64))
        self.code('REQUEST_REQUIRED',lambda:self.run_control('request-get','--request',request,'--authority','a'*64,'--app','dev.other.app'))
        self.code('SESSION_BUSY',lambda:self.run_control('request-create','--app',APP,'--name','Other task','--authority','a'*64,'--audience','00000000-0000-4000-8000-000000000001'))
        value=c.private_read(self.root/'request.json');value['expiresAt']=time.time()-1;c.private_write(self.root/'request.json',value)
        self.code('REQUEST_REQUIRED',lambda:self.run_control('request-approve','--request',request,'--authority','a'*64,'--audience','00000000-0000-4000-8000-000000000001'))
        self.assertEqual(self.fake.calls,[])

    def test_phone_stop_cancels_only_its_owned_session(self):
        request=self.request()
        self.run_control('request-approve','--request',request,'--authority','a'*64,'--audience','00000000-0000-4000-8000-000000000001')
        self.run_control('open','--app',APP,'--request',request,'--authority','a'*64)
        session=c.private_read(self.root/'session.json');session['request']='another-request';c.private_write(self.root/'session.json',session)
        self.fake.calls=[]
        self.code('SESSION_BUSY',lambda:self.run_control('request-cancel','--request',request,'--authority','a'*64,'--audience','00000000-0000-4000-8000-000000000001'))
        self.assertEqual(self.fake.calls,[])
        session['request']=request;c.private_write(self.root/'session.json',session)
        with patch.object(c.socket,'create_connection',side_effect=ConnectionRefusedError):
            stopped=self.run_control('request-cancel','--request',request,'--authority','a'*64,'--audience','00000000-0000-4000-8000-000000000001')
        self.assertEqual(stopped['outcome'],'request-cancelled');self.assertFalse((self.root/'session.json').exists())

    def test_duration_is_phone_selected_immutable_and_bounds_agent_lease(self):
        request=self.request()
        approval=['request-approve','--request',request,'--authority','a'*64,'--audience','00000000-0000-4000-8000-000000000001']
        self.code('INVALID_OPTIONS',lambda:self.run_control(*approval,'--minutes','120'))
        self.run_control(*approval,'--minutes','30')
        self.code('REQUEST_REQUIRED',lambda:self.run_control(*approval,'--minutes','60'))
        self.fake.calls=[]
        self.code('UPDATE_REQUIRED',lambda:self.run_control('open','--app',APP,'--request',request,'--authority','a'*64))
        self.assertNotIn('activate_app',[m for m,_ in self.fake.calls])
        self.fake.duration=1800;self.fake.lifetime=1790
        self.code('APPROVAL_REQUIRED',lambda:self.run_control('open','--app',APP,'--request',request,'--authority','a'*64,'--minutes','60'))
        opened=self.run_control('open','--app',APP,'--request',request,'--authority','a'*64)
        self.assertEqual(opened['expiresInSeconds'],1788)
        self.assertEqual(c.private_read(self.root/'request.json')['minutes'],30)

    def test_legacy_bounded_runner_remains_available_for_manual_sessions(self):
        self.configure();self.fake.version=c.LEGACY_BOUNDED_VERSION;self.fake.caps.append('swift_sim_lifetime_v1')
        self.assertTrue(self.run_control('check')['automaticStopOnPhone'])
        c.private_write(self.root/'installation.json',{'version':c.LEGACY_BOUNDED_VERSION})
        self.code('BOUNDED_SETUP_REQUIRED',lambda:self.run_control('request-create','--app',APP,'--name','Fixture','--authority','a'*64,'--audience','00000000-0000-4000-8000-000000000001'))
    def test_bounded_runner_shortens_local_lease_without_renewing_phone(self):
        self.fake.version=c.BOUNDED_VERSION;self.fake.caps.extend(['swift_sim_lifetime_v1','swift_sim_duration_v1'])
        opened=self.opened()
        self.assertTrue(opened['automaticStopOnPhone']);self.assertEqual(opened['expiresInSeconds'],478)
        self.assertNotIn('config',[m for m,_ in self.fake.calls])
        self.assertTrue(self.run_control('check')['automaticStopOnPhone'])
    def test_bounded_claim_requires_capability_and_finite_remaining_time(self):
        self.configure();self.fake.version=c.BOUNDED_VERSION
        self.code('UPDATE_REQUIRED',lambda:self.run_control('check'))
        self.fake.caps.extend(['swift_sim_lifetime_v1','swift_sim_duration_v1'])
        for invalid in [float('nan'),float('inf'),True,601,-1]:
            self.fake.lifetime=invalid
            self.code('UPDATE_REQUIRED',lambda:self.run_control('check'))
        self.fake.lifetime=2
        self.code('SESSION_ENDING',lambda:self.run_control('open','--app',APP))
        self.assertNotIn('activate_app',[m for m,_ in self.fake.calls])
    def test_readiness_preserves_identity_lock_and_ambiguous_connection_boundaries(self):
        self.configure();self.fake.locked=True
        self.code('PHONE_LOCKED',lambda:self.run_control('check'))
        self.fake.locked=False;self.fake.device='different-phone'
        self.code('DEVICE_CHANGED',lambda:self.run_control('check'))
        self.fake.device='fixture-phone';self.fake.broken='device_info'
        self.code('CONNECTION_UNCONFIRMED',lambda:self.run_control('check'))
        self.assertTrue(all(m=='device_info' for m,_ in self.fake.calls))
    def test_public_or_named_endpoints_rejected_without_rpc(self):
        for host in ['8.8.8.8','127.0.0.1','192.168.1.2','example.test','100.64.0.2@evil','http://100.64.0.2']:
            self.code('INVALID_OPTIONS',lambda:c.endpoint(host,8200))
        self.assertEqual(c.endpoint('fd7a:115c:a1e0::1',8200),'[fd7a:115c:a1e0::1]:8200')
    def test_symlink_and_broad_permissions_refused(self):
        target=self.base/'target';target.mkdir(mode=0o700);self.root.symlink_to(target)
        self.code('PRIVATE_STATE_REQUIRED',self.configure);self.root.unlink();self.store.chmod(0o644)
        self.code('PRIVATE_STATE_REQUIRED',self.configure)
    def test_device_or_provider_change_blocks_activation(self):
        self.configure(); self.fake.device='other-phone'
        self.code('DEVICE_CHANGED',lambda:self.run_control('open','--app',APP))
        self.assertNotIn('activate_app',[m for m,_ in self.fake.calls])
        self.fake.device='fixture-phone';self.fake.version='9.0.0'
        self.code('UPDATE_REQUIRED',lambda:self.run_control('open','--app',APP))
    def test_second_task_cannot_take_over_or_close_owner_session(self):
        opened=self.opened();self.code('SESSION_BUSY',lambda:self.run_control('open','--app',APP))
        self.code('SESSION_REQUIRED',lambda:self.run_control('close','--session','another-task'))
        self.assertNotIn('config',[m for m,_ in self.fake.calls]);self.assertIn('session',opened)
    def test_foreground_switch_rejects_before_read_or_input(self):
        opened=self.opened();self.fake.calls=[];self.fake.front='dev.example.other'
        self.code('FOREGROUND_REQUIRED',lambda:self.run_control('screen','--session',opened['session']))
        self.code('FOREGROUND_REQUIRED',lambda:self.run_control('tap','--session',opened['session'],'--text','Continue'))
        self.assertTrue(all(m=='device_info' for m,_ in self.fake.calls))
    def test_wrong_app_source_is_discarded(self):
        opened=self.opened();self.fake.source_app='dev.example.other'
        self.code('FOREGROUND_REQUIRED',lambda:self.run_control('screen','--session',opened['session']))
    def test_named_tap_uses_scoped_ref_then_observes_result(self):
        opened=self.opened();self.fake.calls=[]
        result=self.run_control('tap','--session',opened['session'],'--text','Continue','--type','button')
        self.assertEqual(result['outcome'],'input-sent');self.assertTrue(result['sourceChanged'])
        self.assertEqual(next(p for m,p in self.fake.calls if m=='find_element')['bundle_id'],APP)
        self.assertEqual(next(p for m,p in self.fake.calls if m=='tap')['ref'],'app-bound-reference')
        self.assertNotIn('data',result)
    def test_coordinate_and_type_require_unused_fresh_observation(self):
        opened=self.opened();sid=opened['session'];obs=opened['observation']
        self.code('OBSERVATION_REQUIRED',lambda:self.run_control('type','--session',sid,'--text','hello'))
        self.run_control('tap','--session',sid,'--observation',obs,'--x','100','--y','120')
        self.code('OBSERVATION_REQUIRED',lambda:self.run_control('type','--session',sid,'--observation',obs,'--text','hello'))
        session=c.private_read(self.root/'session.json');session['observation']['at']=time.time()-61;c.private_write(self.root/'session.json',session)
        self.code('OBSERVATION_REQUIRED',lambda:self.run_control('scroll','--session',sid,'--observation',session['observation']['id'],'--direction','down'))
    def test_scroll_names_content_direction_and_rereads(self):
        opened=self.opened();self.fake.calls=[]
        self.run_control('scroll','--session',opened['session'],'--observation',opened['observation'],'--direction','down')
        self.assertEqual(next(p for m,p in self.fake.calls if m=='swipe')['direction'],'up')
        self.assertTrue(any(m=='page_source' for m,_ in self.fake.calls))
    def test_ambiguous_input_is_never_retried_and_consumes_observation(self):
        opened=self.opened();self.fake.calls=[];self.fake.broken='type'
        self.code('ACTION_UNCONFIRMED',lambda:self.run_control('type','--session',opened['session'],'--observation',opened['observation'],'--text','hello'))
        self.assertEqual(sum(m=='type' for m,_ in self.fake.calls),1)
        self.assertTrue(c.private_read(self.root/'session.json')['observation']['used'])
    def test_full_screen_fallback_never_saved(self):
        opened=self.opened();self.fake.capture_scope='screen'
        self.code('CAPTURE_UNAVAILABLE',lambda:self.run_control('screenshot','--session',opened['session']))
        self.assertFalse((self.root/'screenshots').exists())
    def test_app_capture_is_private_and_provides_point_observation(self):
        opened=self.opened();result=self.run_control('screenshot','--session',opened['session'])
        self.assertEqual(result['outcome'],'captured');self.assertEqual(result['imageScale'],1)
        self.assertEqual(stat.S_IMODE(Path(result['path']).stat().st_mode),0o600)
        self.assertIn('observation',result);self.assertNotIn('data',result)
        self.run_control('tap','--session',opened['session'],'--observation',result['observation'],'--x','50','--y','60')
    def test_unrelated_flags_rejected_before_optional_state_is_created(self):
        self.code('INVALID_OPTIONS',lambda:self.run_control('status','--app',APP))
        self.assertFalse(self.root.exists());self.assertEqual(self.fake.calls,[])
    def test_expired_lease_blocks_input_but_retains_owned_shutdown(self):
        opened=self.opened();session=c.private_read(self.root/'session.json');session['expiresAt']=0;c.private_write(self.root/'session.json',session)
        self.code('SESSION_REQUIRED',lambda:self.run_control('tap','--session',opened['session'],'--text','Continue'))
        with patch.object(c.socket,'create_connection',side_effect=ConnectionRefusedError):
            result=self.run_control('close','--session',opened['session'])
        self.assertTrue(result['runnerStopped']);self.assertFalse((self.root/'session.json').exists())
    def test_unknown_stop_does_not_release_ownership(self):
        opened=self.opened()
        with patch.object(c.socket,'create_connection',side_effect=TimeoutError):
            self.code('STOP_UNCONFIRMED',lambda:self.run_control('close','--session',opened['session']))
        self.assertTrue((self.root/'session.json').exists())
    def test_real_provider_transport_refuses_redirects(self):
        self.configure(); hits=[]
        class Target(http.server.BaseHTTPRequestHandler):
            def do_POST(self): hits.append('followed');self.send_response(200);self.end_headers()
            def log_message(self,*args):pass
        destination=http.server.ThreadingHTTPServer(('127.0.0.1',0),Target)
        class Redirect(http.server.BaseHTTPRequestHandler):
            def do_POST(self):
                self.send_response(307);self.send_header('Location',f'http://127.0.0.1:{destination.server_port}/stolen');self.end_headers()
            def log_message(self,*args):pass
        origin=http.server.ThreadingHTTPServer(('127.0.0.1',0),Redirect)
        threads=[threading.Thread(target=server.serve_forever,daemon=True) for server in [origin,destination]]
        for thread in threads:thread.start()
        try:
            provider=c.Provider(self.root,c.read_profile(self.root))
            provider.host=f'127.0.0.1:{origin.server_port}'  # Test-only transport injection after production endpoint validation.
            with self.assertRaises(BaseException):provider.call('device_info')
            self.assertEqual(hits,[])
        finally:
            origin.shutdown();destination.shutdown();origin.server_close();destination.server_close()
            for thread in threads:thread.join(timeout=2)
    def test_local_lock_prevents_overlapping_commands(self):
        self.configure()
        with c.exclusive(self.root):self.code('SESSION_BUSY',lambda:self.run_control('status'))

    def test_shutdown_waits_for_inflight_action_without_repeating_input(self):
        request=self.request();started=threading.Event();release=threading.Event()
        def action():
            with c.exclusive(self.root):
                started.set();release.wait(timeout=2)
        thread=threading.Thread(target=action);thread.start();self.assertTrue(started.wait(timeout=1))
        timer=threading.Timer(0.15,release.set);timer.start()
        try:
            # Ordinary work still fails immediately; only shutdown opts into waiting.
            self.code('SESSION_BUSY',lambda:self.run_control('status'))
            result=self.run_control('request-cancel','--request',request,'--authority','a'*64,'--audience','00000000-0000-4000-8000-000000000001')
            self.assertEqual(result['outcome'],'request-cancelled');self.assertTrue(release.is_set())
            self.assertEqual(self.fake.calls,[])
        finally:
            release.set();thread.join(timeout=2);timer.join(timeout=2)

if __name__ == '__main__': unittest.main()
