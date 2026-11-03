import {
  createIcons as renderIcons,
  ArrowLeft, ArrowUpRight, BatteryCharging, Bell, ChartNoAxesCombined,
  Download, Eye, FileText, FlaskConical, Grid3x3, Hash, Hexagon, House,
  LayoutDashboard, LockKeyhole, Mail, Maximize, Menu, Minus, Moon, Plus,
  Power, PowerOff, Radio, RefreshCw, Repeat2, RotateCcw, Route,
  Settings2, Sun, Tag, Terminal, Thermometer, TriangleAlert, Usb, UserRound, X, Zap
} from 'lucide';

const icons = {
  ArrowLeft, ArrowUpRight, BatteryCharging, Bell, ChartNoAxesCombined,
  Download, Eye, FileText, FlaskConical, Grid3x3, Hash, Hexagon, House,
  LayoutDashboard, LockKeyhole, Mail, Maximize, Menu, Minus, Moon, Plus,
  Power, PowerOff, Radio, RefreshCw, Repeat2, RotateCcw, Route,
  Settings2, Sun, Tag, Terminal, Thermometer, TriangleAlert, Usb, UserRound, X, Zap
};

export function createIcons(options = {}) {
  renderIcons({ icons, ...options });
}
