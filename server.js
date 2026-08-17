const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const cors = require('cors');
const jwt = require('jsonwebtoken');

const app = express();
const PORT = process.env.PORT || 3001;
const JWT_SECRET = 'dlsystem_secret_key_prod';

app.use(cors());
app.use(express.json());

app.use(express.static(__dirname));
// Rotas explícitas para os arquivos HTML
app.get('/agendar.html', (req, res) => {
    res.sendFile(__dirname + '/agendar.html');
});

app.get('/AGENDA%20AUTOMATIZADA.html', (req, res) => {
    res.sendFile(__dirname + '/AGENDA AUTOMATIZADA.html');
});
app.get('/login.html', (req, res) => {
    res.sendFile(__dirname + '/login.html');
});
// ==========================================
// ROTAS DE ATALHO PARA A AGENDA PÚBLICA
// ==========================================
app.get('/salon-settings', (req, res) => {
    req.url = '/api/public/salon-settings' + (req.url.includes('?') ? req.url.substring(req.url.indexOf('?')) : '');
    app.handle(req, res);
});

app.get('/servicos', (req, res) => {
    req.url = '/api/public/services' + (req.url.includes('?') ? req.url.substring(req.url.indexOf('?')) : '');
    app.handle(req, res);
});

app.get('/profissionais', (req, res) => {
    req.url = '/api/public/professionals' + (req.url.includes('?') ? req.url.substring(req.url.indexOf('?')) : '');
    app.handle(req, res);
});
// Conexão com o Banco de Dados SQLite
const path = require('path');

// Se estiver na Vercel, usa o diretório temporário /tmp. Se estiver local, usa a pasta atual.
const dbPath = process.env.VERCEL ? path.join('/tmp', 'dlsystem.db') : './dlsystem.db';

const db = new sqlite3.Database(dbPath, (err) => {
    if (err) {
        console.error('Erro ao conectar ao banco de dados:', err.message);
    } else {
        console.log('Conectado ao banco de dados SQLite com sucesso em:', dbPath);
    }
});

// Inicialização das Tabelas de Dados
db.serialize(() => {
    // Tabela de Usuários (Salões)
    db.run(`CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        email TEXT UNIQUE NOT NULL,
        password TEXT NOT NULL
    )`);
// Tabela de Fluxo de Caixa (Comissões e Lançamentos)
    db.run(`CREATE TABLE IF NOT EXISTS cash_flow (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER,
        type TEXT,
        description TEXT,
        amount REAL,
        date TEXT
    )`);
    // Tabela de Clientes
    db.run(`CREATE TABLE IF NOT EXISTS clients (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER,
        name TEXT NOT NULL,
        phone TEXT,
        medical_conditions TEXT,
        FOREIGN KEY(user_id) REFERENCES users(id)
    )`);
    // Tabela de Fluxo de Caixa (Comissões e Lançamentos)
    db.run(`CREATE TABLE IF NOT EXISTS cash_flow (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER,
        type TEXT,
        description TEXT,
        amount REAL,
        date TEXT
    )`);

    // Tabela de Serviços com campos específicos para cobrar sinal por serviço
    db.run(`CREATE TABLE IF NOT EXISTS services (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER,
        name TEXT NOT NULL,
        price REAL NOT NULL,
        duration INTEGER,
        return_days INTEGER DEFAULT 30,
        charge_advance INTEGER DEFAULT 0, -- 0 = Não cobra sinal, 1 = Cobra sinal
        advance_value REAL DEFAULT 0.0,   -- Valor do sinal específico deste serviço
        FOREIGN KEY(user_id) REFERENCES users(id)
    )`);

    // Tabela de Profissionais
    db.run(`CREATE TABLE IF NOT EXISTS professionals (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER,
        name TEXT NOT NULL,
        phone TEXT,
        commission_rate REAL DEFAULT 0.0,
        FOREIGN KEY(user_id) REFERENCES users(id)
    )`);

    // Tabela de Agendamentos (Appointments)
    db.run(`CREATE TABLE IF NOT EXISTS appointments (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER,
        client_id INTEGER,
        service_id INTEGER,
        professional_id INTEGER,
        date TEXT NOT NULL,
        time TEXT NOT NULL,
        price REAL,
        status TEXT DEFAULT 'pending', -- 'pending', 'concluded' ou 'cancelled'
        payment_status TEXT DEFAULT 'pending', -- 'pending', 'paid' ou 'pending_validation'
        reminder_4h INTEGER DEFAULT 0,
        FOREIGN KEY(user_id) REFERENCES users(id),
        FOREIGN KEY(client_id) REFERENCES clients(id),
        FOREIGN KEY(service_id) REFERENCES services(id),
        FOREIGN KEY(professional_id) REFERENCES professionals(id)
    )`);

    // Tabela de Estoque de Produtos
    db.run(`CREATE TABLE IF NOT EXISTS products (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER,
        name TEXT NOT NULL,
        quantity INTEGER DEFAULT 0,
        min_quantity INTEGER DEFAULT 5,
        price_cost REAL DEFAULT 0.0,
        FOREIGN KEY(user_id) REFERENCES users(id)
    )`);

    // Tabela Financeira (Fluxo de Caixa)
    db.run(`CREATE TABLE IF NOT EXISTS financial_transactions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER,
        type TEXT NOT NULL, -- 'entry' (receita) ou 'outflow' (despesa)
        description TEXT NOT NULL,
        amount REAL NOT NULL,
        date TEXT NOT NULL,
        category TEXT,
        status TEXT DEFAULT 'approved', -- 'approved' ou 'pending_validation'
        professional_id INTEGER,
        commission_amount REAL DEFAULT 0.0,
        FOREIGN KEY(user_id) REFERENCES users(id),
        FOREIGN KEY(professional_id) REFERENCES professionals(id)
    )`);

    db.run(`ALTER TABLE financial_transactions ADD COLUMN status TEXT DEFAULT 'approved'`, (err) => {});

    // Configurações Globais do Salão
   db.run(`CREATE TABLE IF NOT EXISTS salon_settings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER UNIQUE,
    charge_advance INTEGER DEFAULT 0,
    advance_value REAL DEFAULT 0.0,
    explanatory_message TEXT,
    pix_key TEXT,
    support_phone TEXT,
    google_calendar_integrated INTEGER DEFAULT 0,
    advance_services_ids TEXT DEFAULT '[]',
    FOREIGN KEY(user_id) REFERENCES users(id)
)`);

    db.run(`ALTER TABLE salon_settings ADD COLUMN advance_services_ids TEXT DEFAULT '[]'`, (err) => {});

    // Grade de Horários Ativos do Salão
    db.run(`CREATE TABLE IF NOT EXISTS salon_schedules (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER,
        time TEXT NOT NULL,
        active INTEGER DEFAULT 1, -- 1 = Disponível/Ativo, 0 = Inativo,
        UNIQUE(user_id, time),
        FOREIGN KEY(user_id) REFERENCES users(id)
    )`);
});

// Middleware de Autenticação JWT
function authenticateToken(req, res, next) {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
    if (!token) return res.status(401).json({ error: 'Acesso negado. Token não fornecido.' });

    jwt.verify(token, JWT_SECRET, (err, user) => {
        if (err) return res.status(403).json({ error: 'Sessão expirada. Refaça o login.' });
        req.user = user;
        next();
    });
}

// ==========================================
// ROTAS DE AUTENTICAÇÃO
// ==========================================
app.post('/api/auth/register', (req, res) => {
    const { name, email, password } = req.body;
    db.run(`INSERT INTO users (name, email, password) VALUES (?, ?, ?)`, [name, email, password], function(err) {
        if (err) return res.status(400).json({ error: 'Este e-mail já está cadastrado.' });
        const userId = this.lastID;
        const token = jwt.sign({ id: userId, email }, JWT_SECRET);

        db.run(`INSERT OR IGNORE INTO salon_settings (user_id, charge_advance, advance_value, explanatory_message, pix_key, advance_services_ids) VALUES (?, 0, 0.0, '', '', '[]')`, [userId]);

        const horariosPadrao = ["09:00", "10:00", "11:00", "13:30", "14:30", "15:30", "16:30"];
        horariosPadrao.forEach(hora => {
            db.run(`INSERT OR IGNORE INTO salon_schedules (user_id, time, active) VALUES (?, ?, 1)`, [userId, hora]);
        });

        res.status(201).json({ token, salon: { name, avatar: name.substring(0,2).toUpperCase() } });
    });
});

app.post('/api/auth/login', (req, res) => {
    const { email, password } = req.body;
    db.get(`SELECT * FROM users WHERE email = ? AND password = ?`, [email, password], (err, user) => {
        if (err || !user) return res.status(400).json({ error: 'E-mail ou senha incorretos.' });
        const token = jwt.sign({ id: user.id, email: user.email }, JWT_SECRET);
        res.json({ token, salon: { name: user.name, avatar: user.name.substring(0,2).toUpperCase() } });
    });
});

// ==========================================
// MÓDULO DE CLIENTES
// ==========================================
app.post('/api/clients', authenticateToken, (req, res) => {
    const { name, phone, medical_conditions } = req.body;
    db.run(`INSERT INTO clients (user_id, name, phone, medical_conditions) VALUES (?, ?, ?, ?)`, 
        [req.user.id, name, phone, medical_conditions], function(err) {
            if (err) return res.status(500).json({ error: err.message });
            res.status(201).json({ id: this.lastID });
    });
});

app.get('/api/clients', (req, res) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
    let loggedUserId = null;

    if (token) {
        try {
            const decoded = jwt.verify(token, JWT_SECRET);
            loggedUserId = decoded.id;
        } catch (e) {}
    }

    const userId = loggedUserId ? loggedUserId : (req.query.user_id ? req.query.user_id : 1);

    db.all(`SELECT * FROM clients WHERE user_id = ?`, [userId], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows || []);
    });
});

// ==========================================
// MÓDULO DE SERVIÇOS
// ==========================================
app.post('/api/services', authenticateToken, (req, res) => {
    const { name, price, duration, return_days, charge_advance, advance_value } = req.body;
    db.run(`INSERT INTO services (user_id, name, price, duration, return_days, charge_advance, advance_value) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [req.user.id, name, price, duration, return_days || 30, charge_advance ? 1 : 0, advance_value || 0.0], function(err) {
            if (err) return res.status(500).json({ error: err.message });
            res.status(201).json({ id: this.lastID });
        });
});

app.get('/api/services', (req, res) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
    let loggedUserId = null;

    if (token) {
        try {
            const decoded = jwt.verify(token, JWT_SECRET);
            loggedUserId = decoded.id;
        } catch (e) {}
    }

    const userId = loggedUserId ? loggedUserId : (req.query.user_id ? req.query.user_id : 1);

    db.all(`SELECT * FROM services WHERE user_id = ?`, [userId], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows || []);
    });
});

// ==========================================
// MÓDULO DE PROFISSIONAIS
// ==========================================
app.post('/api/professionals', authenticateToken, (req, res) => {
    const { name, phone, commission_rate } = req.body;
    if (!name) return res.status(400).json({ error: "O nome do profissional é obrigatório." });

    db.run(`INSERT INTO professionals (user_id, name, phone, commission_rate) VALUES (?, ?, ?, ?)`,
        [req.user.id, name, phone, commission_rate || 0.0], function(err) {
            if (err) return res.status(500).json({ error: "Erro ao cadastrar profissional." });
            res.status(201).json({ id: this.lastID });
    });
});

app.get('/api/professionals', (req, res) => {
    const userId = req.query.user_id || 1; 
    db.all('SELECT * FROM professionals WHERE user_id = ?', [userId], (err, rows) => {
        if (err) return res.status(500).json({ error: "Erro ao buscar profissionais." });
        res.json(rows || []);
    });
});

// ==========================================
// CONFIGURAÇÕES DO SALÃO E GRADE DE HORÁRIOS
// ==========================================
const handleGetSettings = (req, res) => {
    const userId = req.query.user_id || 1;
    db.get(`SELECT * FROM salon_settings WHERE user_id = ?`, [userId], (err, row) => {
        if (err) return res.status(500).json({ error: err.message });
        if (!row) {
            return res.json({ charge_advance: 0, advance_value: 0.0, explanatory_message: '', pix_key: '', advance_services_ids: [] });
        }
        
        try {
            if (typeof row.advance_services_ids === 'string') {
                row.advance_services_ids = JSON.parse(row.advance_services_ids);
            }
        } catch (e) {
            row.advance_services_ids = [];
        }

        res.json(row);
    });
};

// Suporta tanto /api/settings quanto /api/salon/settings
app.get('/api/settings', handleGetSettings);
app.get('/api/salon/settings', handleGetSettings);

app.post('/api/salon/settings', authenticateToken, (req, res) => {
    const { charge_advance, advance_value, explanatory_message, pix_key, advance_services_ids, support_phone } = req.body;
    
    const stringIdsServicos = Array.isArray(advance_services_ids)
        ? JSON.stringify(advance_services_ids)
        : (typeof advance_services_ids === 'string' ? advance_services_ids : '[]');

    db.run(`INSERT INTO salon_settings (user_id, charge_advance, advance_value, explanatory_message, pix_key, advance_services_ids, support_phone)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(user_id) DO UPDATE SET 
                charge_advance = excluded.charge_advance,
                advance_value = excluded.advance_value,
                explanatory_message = excluded.explanatory_message,
                pix_key = excluded.pix_key,
                advance_services_ids = excluded.advance_services_ids,
                support_phone = excluded.support_phone`,
        [req.user.id, charge_advance ? 1 : 0, advance_value || 0.0, explanatory_message, pix_key, stringIdsServicos, support_phone],
        function(err) {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ success: true });
        }
    );
});

// ==========================================
// MÓDULO DE AGENDAMENTOS (APPOINTMENTS)
// ==========================================
app.get('/api/appointments', (req, res) => {
    let { date } = req.query;
    
    if (!date) {
        const hoje = new Date();
        const ano = hoje.getFullYear();
        const mes = String(hoje.getMonth() + 1).padStart(2, '0');
        const dia = String(hoje.getDate()).padStart(2, '0');
        date = `${ano}-${mes}-${dia}`;
    }

    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (token) {
        jwt.verify(token, JWT_SECRET, (err, decodedUser) => {
            if (err) return res.status(403).json({ error: "Sessão expirada. Refaça o login." });

            const queryAdmin = `
                SELECT a.id, a.user_id, a.client_id, a.service_id, a.professional_id, a.date, a.time, a.price, a.status, a.payment_status,
                       c.name AS client_name, c.phone AS client_phone, c.medical_conditions AS client_conditions,
                       s.name AS service_name, s.price AS service_price, 
                       p.name AS professional_name
                FROM appointments a
                LEFT JOIN clients c ON a.client_id = c.id
                LEFT JOIN services s ON a.service_id = s.id
                LEFT JOIN professionals p ON a.professional_id = p.id
                WHERE a.date = ? AND a.user_id = ? AND a.status != 'concluded'
            `;

            db.all(queryAdmin, [date, decodedUser.id], (err, rows) => {
                if (err) return res.status(500).json({ error: err.message });
                return res.json(rows || []);
            });
        });
    } else {
        const queryPublico = `
            SELECT time FROM appointments 
            WHERE date = ? AND status != 'concluded'
        `;

        db.all(queryPublico, [date], (err, rows) => {
            if (err) return res.status(500).json({ error: err.message });
            return res.json(rows || []);
        });
    }
});

app.post('/api/appointments', authenticateToken, (req, res) => {
    const { client_id, service_id, professional_id, date, time, price, payment_status } = req.body;
    db.run(`INSERT INTO appointments (user_id, client_id, service_id, professional_id, date, time, price, payment_status) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [req.user.id, client_id, service_id, professional_id, date, time, price, payment_status || 'pending'], function(err) {
            if (err) return res.status(500).json({ error: err.message });
            
            db.get(`SELECT medical_conditions FROM clients WHERE id = ?`, [client_id], (err, client) => {
                let healthAlert = (client && client.medical_conditions === 'diabetes') ? "Cliente possui Diabetes. Atenção redobrada!" : null;
                res.status(201).json({ id: this.lastID, healthAlert });
            });
    });
});

app.patch('/api/appointments/:id/payment', authenticateToken, (req, res) => {
    const { payment_status } = req.body; 
    const appointmentId = req.params.id;
    const userId = req.user.id;

    db.run(`UPDATE appointments SET payment_status = ? WHERE id = ? AND user_id = ?`,
        [payment_status, appointmentId, userId], function(err) {
            if (err) return res.status(500).json({ error: err.message });
            
            if (payment_status === 'paid') {
                db.get(`SELECT a.*, c.name AS client_name FROM appointments a 
                        LEFT JOIN clients c ON a.client_id = c.id 
                        WHERE a.id = ?`, [appointmentId], (err, appt) => {
                    
                    if (appt) {
                        const termoBusca = `%Cliente: ${appt.client_name}%`;
                        db.run(`UPDATE financial_transactions SET status = 'approved' 
                                WHERE user_id = ? AND description LIKE ? AND status = 'pending_validation'`, 
                                [userId, termoBusca]);
                    }
                });
            }
            
            res.json({ success: true });
        }
    );
});

app.patch('/api/appointments/:id/status', authenticateToken, (req, res) => {
    const { status } = req.body;
    const appointmentId = req.params.id;
    const userId = req.user.id;

    if (status === 'concluded') {
        db.get(`SELECT a.*, s.name as service_name, c.name as client_name FROM appointments a 
                LEFT JOIN services s ON a.service_id = s.id 
                LEFT JOIN clients c ON a.client_id = c.id
                WHERE a.id = ? AND a.user_id = ?`, [appointmentId, userId], (err, appt) => {
            
            if (err || !appt) {
                return res.status(500).json({ error: "Erro ao buscar detalhes do agendamento." });
            }

            db.run(`UPDATE appointments SET status = 'concluded', payment_status = 'paid' WHERE id = ? AND user_id = ?`, 
                [appointmentId, userId], function(err) {
                    if (err) return res.status(500).json({ error: "Erro ao atualizar agendamento." });

                    const valorLancamento = appt.price || 0;
                    const descricaoLancamento = `Atendimento: ${appt.client_name || 'Cliente'} - ${appt.service_name || 'Serviço'}`;
                    const dataHoje = new Date().toISOString().split('T')[0];

                    db.run(`INSERT INTO financial_transactions (user_id, type, description, amount, date, category, status) VALUES (?, 'entry', ?, ?, ?, 'Serviços', 'approved')`,
                        [userId, descricaoLancamento, valorLancamento, dataHoje], (err) => {
                            if (err) console.error("Erro ao registrar transação automática:", err);
                            res.json({ success: true, message: "Atendimento concluído e registrado no financeiro!" });
                        });
                });
        });
    } else {
        db.run(`UPDATE appointments SET status = ? WHERE id = ? AND user_id = ?`, [status, appointmentId, userId], (err) => {
            if (err) return res.status(500).json({ error: "Erro ao atualizar status." });
            res.json({ success: true });
        });
    }
});

// ==========================================
// ROTA DA AGENDA PÚBLICA
// ==========================================
app.post('/api/public/appointments', (req, res) => {
    const { user_id, client_name, client_phone, service_id, professional_id, date, time, health_notes } = req.body;
    const targetUserId = user_id || 1;

    if (!client_name || !client_phone || !service_id || !date || !time) {
        return res.status(400).json({ error: "Campos obrigatórios ausentes." });
    }

    db.get("SELECT id FROM clients WHERE phone = ? AND user_id = ?", [client_phone, targetUserId], (err, clientRow) => {
        if (err) return res.status(500).json({ error: err.message });

        if (clientRow) {
            if (health_notes) {
                db.run("UPDATE clients SET medical_conditions = ? WHERE id = ?", [health_notes, clientRow.id]);
            }
            saveAppointment(clientRow.id);
        } else {
            db.run(
                "INSERT INTO clients (user_id, name, phone, medical_conditions) VALUES (?, ?, ?, ?)",
                [targetUserId, client_name, client_phone, health_notes || null],
                function (err) {
                    if (err) return res.status(500).json({ error: err.message });
                    saveAppointment(this.lastID);
                }
            );
        }
    });

    function saveAppointment(clientId) {
        db.get(`SELECT price, charge_advance, advance_value FROM services WHERE id = ?`, [service_id], (err, service) => {
            if (err || !service) return res.status(500).json({ error: "Serviço não encontrado." });

            db.get(`SELECT charge_advance, advance_value, pix_key, support_phone, explanatory_message FROM salon_settings WHERE user_id = ?`, [targetUserId], (err, settings) => {
                
                const servicoCobra = Number(service.charge_advance) === 1;
                const globalCobra = settings && Number(settings.charge_advance) === 1;
                const cobraSinal = servicoCobra || globalCobra;
                
                const valorSinal = cobraSinal 
                    ? (Number(service.advance_value) > 0 ? Number(service.advance_value) : Number(settings?.advance_value || 0))
                    : 0;

                const statusPagamento = cobraSinal ? 'pending_validation' : 'pending';

                db.run(
                    `INSERT INTO appointments (user_id, client_id, service_id, professional_id, date, time, price, status, payment_status) VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?)`,
                    [targetUserId, clientId, service_id, professional_id, date, time, service.price, statusPagamento],
                    function(err) {
                        if (err) return res.status(500).json({ error: err.message });
                        const appointmentId = this.lastID;

                        if (cobraSinal && valorSinal > 0) {
                            const dataHoje = new Date().toISOString().split('T')[0];
                            const descricaoSinal = `Sinal recebido (Pendente de Validação) - Cliente: ${client_name}`;

                            db.run(
                                `INSERT INTO financial_transactions (user_id, type, description, amount, date, category, status) VALUES (?, 'entry', ?, ?, ?, 'Sinal Antecipado', 'pending_validation')`,
                                [targetUserId, descricaoSinal, valorSinal, dataHoje],
                                (err) => {
                                    if (err) console.error("Erro ao registrar transação:", err);
                                    return res.json({
                                        success: true,
                                        appointmentId: appointmentId,
                                        charge_advance: true,
                                        advance_value: valorSinal,
                                        pix_key: settings?.pix_key || '',
                                        support_phone: settings?.support_phone || '',
                                        explanatory_message: settings?.explanatory_message || ''
                                    });
                                }
                            );
                        } else {
                            return res.json({
                                success: true,
                                appointmentId: appointmentId,
                                charge_advance: false,
                                advance_value: 0
                            });
                        }
                    }
                );
            });
        });
    }
});

// ==========================================
// PAINEL INTELIGENTE (ANALYTICS, PREDIÇÕES & CRM)
// ==========================================
app.get('/api/analytics/predictions', authenticateToken, (req, res) => {
    const userId = req.user.id;
    const hoje = new Date().toISOString().split('T')[0];

    const queryHoje = `SELECT SUM(amount) as total FROM financial_transactions WHERE user_id = ? AND date = ? AND type = 'entry' AND status = 'approved'`;
    const queryFuturo = `SELECT SUM(price) as total FROM appointments WHERE user_id = ? AND date >= ? AND status = 'pending'`;

    db.get(queryHoje, [userId, hoje], (err, rowHoje) => {
        if (err) return res.status(500).json({ error: "Erro ao gerar analytics." });
        
        db.get(queryFuturo, [userId, hoje], (err, rowFuturo) => {
            if (err) return res.status(500).json({ error: "Erro ao gerar predições." });

            const faturamento_atual = rowHoje?.total || 0.0;
            const faturamento_preditivo = faturamento_atual + (rowFuturo?.total || 0.0);

            let insight = "Continue promovendo seus serviços online para preencher novos horários na semana!";
            if (faturamento_preditivo > faturamento_atual * 1.5) {
                insight = "Excelente! Alta ocupação detectada para os próximos dias. Prepare seu estoque de produtos.";
            }

            res.json({
                faturamento_atual: faturamento_atual,
                faturamento_preditivo: faturamento_preditivo,
                taxa_ocupacao_atual: "65%",
                taxa_ocupacao_preditiva: "82%",
                insight: insight
            });
        });
    });
});

app.get('/api/crm/churn-risks', authenticateToken, (req, res) => {
    const userId = req.user.id;

    const queryChurn = `
        SELECT c.name as client_name, c.phone as client_phone, MAX(a.date) as last_service_date, s.name as last_service
        FROM clients c
        JOIN appointments a ON c.id = a.client_id
        JOIN services s ON a.service_id = s.id
        WHERE c.user_id = ? AND a.status = 'concluded'
        GROUP BY c.id
        HAVING last_service_date < date('now', '-30 days')
        ORDER BY last_service_date ASC
        LIMIT 5
    `;

    db.all(queryChurn, [userId], (err, rows) => {
        if (err) return res.status(500).json({ error: "Erro ao buscar riscos de churn." });
        
        const output = (rows || []).map(row => {
            return {
                client_name: row.client_name,
                client_phone: row.client_phone,
                last_service: row.last_service,
                suggested_message: `Olá ${row.client_name}! Faz um tempo desde seu último procedimento de ${row.last_service}. Que tal agendar um horário para renovar seus cuidados?`
            };
        });
        res.json(output);
    });
});

app.get('/api/analytics/operational-focus', authenticateToken, (req, res) => {
    const userId = req.user.id;

    const query = `
        SELECT s.name as service_name, COUNT(a.id) as total 
        FROM appointments a 
        JOIN services s ON a.service_id = s.id
        WHERE a.user_id = ? AND a.status = 'concluded'
        GROUP BY s.id 
        ORDER BY total DESC 
        LIMIT 1
    `;

    db.get(query, [userId], (err, row) => {
        if (err) {
            console.error(err);
            return res.status(500).json({ error: "Erro interno ao buscar foco operacional." });
        }
        
        const focoText = row ? row.service_name : "Serviços Gerais / Sem Atendimentos no momento";
        res.json({ foco: focoText });
    });
});

app.get('/api/analytics/reminders', authenticateToken, (req, res) => {
    const userId = req.user.id;
    const hoje = new Date().toISOString().split('T')[0];

    const query = `
        SELECT a.id, a.time, c.name as client_name, c.phone as client_phone, s.name as service_name
        FROM appointments a
        JOIN clients c ON a.client_id = c.id
        JOIN services s ON a.service_id = s.id
        WHERE a.user_id = ? 
          AND a.date = ? 
          AND a.status = 'pending'
        ORDER BY a.time ASC
    `;

    db.all(query, [userId, hoje], (err, rows) => {
        if (err) return res.status(500).json({ error: "Erro ao buscar lembretes de horários." });

        const reminders = (rows || []).map(item => {
            const foneLimpo = item.client_phone ? item.client_phone.replace(/\D/g, '') : '';
            const mensagem = encodeURIComponent(`Olá ${item.client_name}! Passando para lembrar do seu agendamento de ${item.service_name} hoje às ${item.time}. Confirmado?`);
            const whatsappUrl = foneLimpo ? `https://wa.me/55${foneLimpo}?text=${mensagem}` : '#';

            return {
                id: item.id,
                time: item.time,
                client_name: item.client_name,
                client_phone: item.client_phone,
                service_name: item.service_name,
                whatsapp_url: whatsappUrl
            };
        });

        res.json(reminders);
    });
});

// ==========================================
// MÓDULO DE ESTOQUE (PRODUTOS)
// ==========================================
app.post('/api/products', authenticateToken, (req, res) => {
    const { name, quantity, min_quantity, price_cost } = req.body;
    db.run(`INSERT INTO products (user_id, name, quantity, min_quantity, price_cost) VALUES (?, ?, ?, ?, ?)`, 
        [req.user.id, name, quantity || 0, min_quantity || 5, price_cost || 0.0], () => res.status(201).json({ success: true }));
});

app.get('/api/products', (req, res) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
    let loggedUserId = null;

    if (token) {
        try {
            const decoded = jwt.verify(token, JWT_SECRET);
            loggedUserId = decoded.id;
        } catch (e) {}
    }

    const userId = loggedUserId ? loggedUserId : (req.query.user_id ? req.query.user_id : 1);

    db.all(`SELECT * FROM products WHERE user_id = ?`, [userId], (err, rows) => {
        if (err) return res.status(500).json({ error: "Erro ao buscar produtos." });
        res.json((rows || []).map(p => ({ ...p, status_estoque: p.quantity <= p.min_quantity ? "CRÍTICO" : "OK" })));
    });
});

app.patch('/api/products/:id/quantity', authenticateToken, (req, res) => {
    const { quantity_change } = req.body;
    db.get(`SELECT quantity FROM products WHERE id = ? AND user_id = ?`, [req.params.id, req.user.id], (err, prod) => {
        if (!prod) return res.status(404).json({ error: "Não encontrado." });
        
        const novaQtd = Math.max(0, prod.quantity + quantity_change);
        db.run(`UPDATE products SET quantity = ? WHERE id = ?`, [novaQtd, req.params.id], () => res.json({ success: true }));
    });
});

// ==========================================
// MÓDULO FINANCEIRO (FLUXO DE CAIXA)
// ==========================================
app.post('/api/financial', authenticateToken, (req, res) => {
    const { type, description, amount, date, category } = req.body;
    db.run(`INSERT INTO financial_transactions (user_id, type, description, amount, date, category, status) VALUES (?, ?, ?, ?, ?, ?, 'approved')`, 
        [req.user.id, type, description, amount, date, category || 'Geral'], (err) => {
            if (err) return res.status(500).json({ error: "Erro ao criar lançamento." });
            res.status(201).json({ success: true });
        });
});

app.get('/api/financial', authenticateToken, (req, res) => {
    db.all(`SELECT * FROM financial_transactions WHERE user_id = ? ORDER BY date DESC`, [req.user.id], (err, rows) => {
        if (err) return res.status(500).json({ error: "Erro ao buscar extrato." });
        
        let e = 0, d = 0;
        (rows || []).forEach(t => { 
            if (t.status === 'approved') {
                if (t.type === 'entry') e += t.amount; 
                else d += t.amount; 
            }
        });
        
        res.json({ 
            transactions: rows || [], 
            resumo: { total_entradas: e, total_despesas: d, saldo_atual: e - d } 
        });
    });
});

// ==========================================
// ROTAS PÚBLICAS COMPLEMENTARES
// ==========================================

// 1. Rota de configurações públicas do salão
app.get('/api/public/salon-settings', (req, res) => {
    const userId = req.query.user_id || 1;
    const sql = `SELECT * FROM salon_settings WHERE user_id = ?`;
    
    db.get(sql, [userId], (err, row) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(row || { support_phone: '5553999999999', pix_key: '', explanatory_message: '' });
    });
});

// 2. Rota de serviços públicos
app.get('/api/public/services', (req, res) => {
    const userId = req.query.user_id || 1;
    db.all(`SELECT * FROM services WHERE user_id = ?`, [userId], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows || []);
    });
});

// 3. Rota de profissionais públicos
app.get('/api/public/professionals', (req, res) => {
    const userId = req.query.user_id || 1;
    db.all(`SELECT * FROM professionals WHERE user_id = ?`, [userId], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows || []);
    });
});

// 4. Rota para calcular os horários livres
app.get('/api/public/available-slots', (req, res) => {
    const userId = req.query.user_id || 1;
    const { date } = req.query; // Ex: "2026-06-06"

    if (!date) return res.status(400).json({ error: "Data obrigatória." });
    const dataObj = new Date(date + 'T00:00:00');
    const diaSemana = dataObj.getDay(); // 0 a 6

    // 2. Buscar a grade de horários específica para esse dia da semana no salão
    // (Caso sua tabela use números para o dia da semana: 0-6)
    const sql = `SELECT time FROM salon_schedules WHERE user_id = ? AND day_of_week = ? AND active = 1`;

    db.all(sql, [userId, diaSemana], (err, grid) => {
        if (err) return res.status(500).json({ error: err.message });

        const todosHorarios = grid.length > 0
            ? grid.map(h => h.time)
            : []; // Evite deixar horários fixos de exemplo na pública para não confundir o cliente

        // O restante da sua lógica de filtragem de horários já agendados continua daqui...
        return res.json({ horarios: todosHorarios });
    });
});
// Rota de conclusão de agendamento corrigida utilizando authenticateToken e o status 'concluded' unificado
app.post('/api/appointments/:id/complete', authenticateToken, (req, res) => {
    const appointmentId = req.params.id;
    const userId = req.user.id;

    db.serialize(() => {
        db.run('BEGIN TRANSACTION');

        // 1. Busca os dados do agendamento (preço, serviço e profissional)
        const selectQuery = `SELECT * FROM appointments WHERE id = ? AND user_id = ?`;
        
        db.get(selectQuery, [appointmentId, userId], (err, appt) => {
            if (err || !appt) {
                db.run('ROLLBACK');
                return res.status(404).json({ error: 'Agendamento não encontrado.' });
            }

            // 2. Atualiza o status do agendamento para concluído
            const updateQuery = `UPDATE appointments SET status = 'concluded' WHERE id = ? AND user_id = ?`;
            
            db.run(updateQuery, [appointmentId, userId], function(updateErr) {
                if (updateErr) {
                    db.run('ROLLBACK');
                    return res.status(500).json({ error: 'Erro ao atualizar agendamento.' });
                }

                // 3. Calcula a comissão (exemplo: 50% do valor do serviço, ajuste se necessário)
                const valorServico = appt.price || 0;
                const valorComissao = valorServico * 0.50; 
                const descricaoCaixa = `Comissão referente ao atendimento #${appt.id} - ${appt.service_name || 'Serviço'}`;

                // 4. Insere o valor da comissão no fluxo de caixa (como saída/despesa)
                const insertCashQuery = `INSERT INTO cash_flow (user_id, description, type, amount, date) VALUES (?, ?, 'expense', ?, datetime('now'))`;

                db.run(insertCashQuery, [userId, descricaoCaixa, valorComissao], (cashErr) => {
                    if (cashErr) {
                        db.run('ROLLBACK');
                        return res.status(500).json({ error: 'Erro ao registrar comissão no fluxo de caixa.' });
                    }

                    // 5. Finaliza a transação com sucesso
                    db.run('COMMIT', (commitErr) => {
                        if (commitErr) {
                            return res.status(500).json({ error: 'Erro ao finalizar transação.' });
                        }
                        res.json({ success: true, message: 'Agendamento concluído e comissão lançada no caixa!' });
                    });
                });
            });
        });
    });
});

// Inicialização do Servidor Express
app.listen(process.env.PORT || 3000, () => {
    console.log(`Servidor rodando na porta ${process.env.PORT || 3000}`);
});