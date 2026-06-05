const express = require('express');
const sql = require('tedious');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const path = require('path');

const app = express();

// --- 1. Cấu hình Middleware ---
app.set('view engine', 'ejs'); //Thiết lập EJS làm bộ máy tạo giao diện, cho phép Server nhúng dữ liệu động (như tên nhân sự hay trạng thái máy) trực tiếp vào mã HTML.
app.set('views', path.join(__dirname, 'templates')); //Chỉ định thư mục templates là nơi chứa các file giao diện (.ejs).
app.use(express.static(path.join(__dirname, 'templates')));//Cho phép trình duyệt truy cập trực tiếp các file tĩnh như CSS, hình ảnh,
// và các file Javascript xử lý biểu đồ Chart.js mà không cần thông qua các route phức tạp.
app.use(express.static(path.join(__dirname)));
app.use(express.urlencoded({ extended: true })); //Dùng để xử lý dữ liệu gửi từ các Form HTML truyền thống, như form đăng nhập và đăng ký, giúp Server có thể đọc được các biến như username hay password.
app.use(express.json());
//Chốt chặn quan trọng nhất đối với thiết bị IoT. Khi ESP32 gửi dữ liệu dưới dạng JSON qua lệnh http.POST(jsonStr), middleware này sẽ bóc tách chuỗi
//  text đó thành một đối tượng Javascript để Server có thể đọc được các biến như temperature hay noise.
app.use(session({
    secret: 'scada_lhu_extreme_security_2026',
    resave: false, saveUninitialized: true,
    cookie: { maxAge: 3600000 }
}));

// ✅ 2. CẤU HÌNH ĐƯỜNG TRUYỀN CHO THƯ VIỆN TEDIOUS CHỌC LÊN SOMEE
const sqlConfig = {
    authentication: {
        type: 'default',
        options: {
            userName: 'NhatLPN23_SQLLogin_1',
            password: '7ap8sb7rwb' // 🌟 Dán mật khẩu ní copy trên web Somee vô đây
        }
    },
    server: 'MechaSCADA_V2.mssql.somee.com',
    options: {
        database: 'MechaSCADA_V2',
        encrypt: true,
        trustServerCertificate: true,
        port: 1433 // Cổng SQL chuẩn kết nối Internet
    }
};

// ✅ 3. TẠO HÀM GIẢ LẬP ĐỂ GIỮ NGUYÊN CÁC LỆNH .request().query() CŨ CỦA NHẬT
const poolPromise = new Promise((resolve, reject) => {
    const connection = new sql.Connection(sqlConfig);
    connection.on('connect', err => {
        if (err) {
            console.error('❌ Lỗi kết nối Somee:', err.message);
            reject(err);
        } else {
            console.log('✅ LH_AUTX: Hệ thống đã thông mạch SQL Server Cloud!');
            
            // Bộ chuyển đổi thích nghi để các API cũ của ní không bị lỗi cú pháp
            const requestAdapter = () => ({
                input: function(name, type, val) { 
                    this.params = this.params || []; 
                    this.params.push({ name, val }); 
                    return this; 
                },
                query: function(sqlStr) {
                    return new Promise((resQ, rejQ) => {
                        let req = new sql.Request(sqlStr, (err, rowCount, rows) => {
                            if (err) return rejQ(err);
                            let recordset = rows.map(row => {
                                let obj = {};
                                row.forEach(col => { obj[col.metadata.colName] = col.value; });
                                return obj;
                            });
                            resQ({ recordset });
                        });
                        if (this.params) { 
                            this.params.forEach(p => req.addParameter(p.name, sql.TYPES.NVarChar, p.val)); 
                        }
                        connection.execSql(req);
                    });
                }
            });
            resolve({ request: requestAdapter });
        }
    });
    connection.connect();
});

// --- 3. Chốt chặn bảo mật (Bản Master "Phá Đảo" cho ní Nhật) ---
app.use((req, res, next) => {
    // 1. Danh sách các trang và API mở hoàn toàn (Không cần Login)
    const publicPages = [
        '/login', 
        '/register', 
        '/api/iot/sensor-data',     // Cổng nhận data từ Wokwi
        '/api/production-data',      // Dữ liệu biểu đồ
        '/api/system-status',        // Trạng thái máy
        '/api/stats/overview',       // 👈 THÊM CÁI NÀY (Đang bị chặn trong log)
        '/api/system-logs'           // Nhật ký hệ thống
    ];

    // 2. Kiểm tra xem có phải là các API bảo trì không (Bắt đầu bằng /api/maintenance/)
    const isMaintenanceApi = req.path.startsWith('/api/maintenance/');
    const isPublic = publicPages.includes(req.path) || req.path.startsWith('/api/iot/');

    // 3. Quyết định: Nếu đã login HOẶC là trang public HOẶC là API bảo trì thì cho qua
    if (req.session.user || isPublic || isMaintenanceApi) {
        next();
    } else {
        // Chỉ in log khi thực sự bị chặn để Terminal đỡ bị rác
        console.log("❌ Chặn khách lạ vào cổng:", req.path);
        return res.redirect('/login'); 
    }
});

// API THÊM THIẾT BỊ MỚI
app.post('/api/admin/add-machine', async (req, res) => {
    if (req.session.user.rank !== 1) return res.status(403).json({status: "denied"});
    const { machine_name, description } = req.body; 
    try {
        const pool = await poolPromise;
        await pool.request()
            .input('n', sql.NVarChar, machine_name)
            .input('d', sql.NVarChar, description)
            .query("INSERT INTO Machines (MachineID, MachineName, Description) VALUES (NEWID(), @n, @d)");
        res.json({status: "success"});
    } catch (err) { res.status(500).json({error: err.message}); }
});

// API XÓA THIẾT BỊ
app.delete('/api/admin/delete-machine/:id', async (req, res) => {
    if (req.session.user.rank !== 1) return res.status(403).json({status: "denied"});
    const mId = req.params.id;
    try {
        const pool = await poolPromise;
        await pool.request().input('id', sql.UniqueIdentifier, mId).query("DELETE FROM Production_Logs WHERE MachineID = @id");
        await pool.request().input('id', sql.UniqueIdentifier, mId).query("DELETE FROM Machine_Status WHERE MachineID = @id");
        await pool.request().input('id', sql.UniqueIdentifier, mId).query("DELETE FROM Downtime_Reasons WHERE MachineID = @id");
        await pool.request().input('id', sql.UniqueIdentifier, mId).query("DELETE FROM Machines WHERE MachineID = @id");
        res.json({status: "success"});
    } catch (err) { res.status(500).json({error: err.message}); }
});

// --- 4. Route Giao diện ---
app.get('/', (req, res) => res.render('dashboard', { user: req.session.user }));

app.get('/login', (req, res) => {
    const welcome = req.query.reg === 'success' ? ['Tài khoản nhân sự đã tạo thành công. Chào mừng bạn đến với công ty!'] : [];
    res.render('login', { messages: [], welcome: welcome });
});

app.get('/register', (req, res) => res.render('register', { messages: [] }));

app.post('/register', async (req, res) => {
    const { fullname, phone, birthdate, username, password, invite_code } = req.body;
    try {
        const pool = await poolPromise;
        const checkCode = await pool.request().input('c', sql.VarChar, invite_code).query("SELECT * FROM InviteCodes WHERE Code = @c");
        if (checkCode.recordset.length === 0) return res.render('register', { messages: ['Mã mời không tồn tại trên hệ thống!'] });
        const roleId = checkCode.recordset[0].RoleID;
        const hash = bcrypt.hashSync(password, 10);
        await pool.request()
            .input('u', sql.VarChar, username).input('p', sql.VarChar, hash)
            .input('r', sql.UniqueIdentifier, roleId).input('f', sql.NVarChar, fullname)
            .input('ph', sql.VarChar, phone).input('bd', sql.Date, birthdate)
            .query(`INSERT INTO Users (Username, PasswordHash, RoleID, FullName, Phone, BirthDate) VALUES (@u, @p, @r, @f, @ph, @bd)`);
        res.redirect('/login?reg=success'); 
    } catch (err) { res.render('register', { messages: ['Lỗi hệ thống: ' + err.message] }); }
});

app.post('/login', async (req, res) => {
    const { username, password } = req.body;
    try {
        const pool = await poolPromise;
        const result = await pool.request().input('u', sql.VarChar, username)
            .query("SELECT u.*, r.RoleName, r.RankLevel FROM Users u JOIN Roles r ON u.RoleID = r.RoleID WHERE u.Username = @u");
        const user = result.recordset[0];
        if (user && bcrypt.compareSync(password, user.PasswordHash)) {
            req.session.user = { id: user.UserID, fullname: user.FullName, role: user.RoleName, rank: user.RankLevel };
            return res.redirect('/');
        }
        res.render('login', { messages: ['Sai tên đăng nhập hoặc mật khẩu!'], welcome: [] });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// --- 5. API Giám sát ---
app.get('/api/production-data', async (req, res) => {
    try {
        const pool = await poolPromise;
        const result = await pool.request().query("SELECT TOP 20 Temperature, NoiseLevel, FORMAT(Timestamp, 'HH:mm') as Time FROM Production_Logs ORDER BY Timestamp DESC");
        res.json({
            labels: result.recordset.map(r => r.Time).reverse(),
            temp: result.recordset.map(r => r.Temperature).reverse(),
            noise: result.recordset.map(r => r.NoiseLevel).reverse()
        });
    } catch (err) { res.status(500).json({ labels: [], temp: [], noise: [] }); }
});

app.get('/api/system-status', async (req, res) => {
    try {
        const pool = await poolPromise;
        const result = await pool.request().query(`
            SELECT CAST(m.MachineID AS VARCHAR(36)) as id, m.MachineName as name, ISNULL(s.StatusName, 'Running') as status 
            FROM Machines m OUTER APPLY (SELECT TOP 1 StatusName FROM Machine_Status WHERE MachineID = m.MachineID ORDER BY Timestamp DESC) s`);
        res.json(result.recordset);
    } catch (err) { res.status(500).json([]); }
});

// --- 6. IOT GATEWAY: TỰ ĐỘNG HÓA HOÀN TOÀN ---
app.post('/api/iot/sensor-data', async (req, res) => {
    console.log("📥 DATA NHẬN TỪ WOKWI:", req.body); 

    const { machine_id, temperature, noise } = req.body;
    try {
        const pool = await poolPromise;

        // 1. Luôn ghi nhật ký data thực tế vào SQL để vẽ biểu đồ
        await pool.request()
            .input('id', sql.UniqueIdentifier, machine_id)
            .input('t', sql.Float, temperature)
            .input('n', sql.Float, noise)
            .query("INSERT INTO Production_Logs (MachineID, Temperature, NoiseLevel, Timestamp) VALUES (@id, @t, @n, GETDATE())");

        // 2. Logic phân tích lỗi tự động
        let currentStatus = 'Running';
        let currentReason = null;

        if (temperature > 60 && noise > 80) {
            // Trường hợp 1: Cả hai cùng lỗi -> Random chọn 1 để hiển thị cho sinh động
            const isTempError = Math.random() < 0.5; 
            currentStatus = isTempError ? 'Error_Temp' : 'Error_Noise';
            currentReason = isTempError ? 'Sự cố: Nhiệt độ quá cao (>60°C)' : 'Cảnh báo: Độ ồn vượt ngưỡng (>80dB)';
        } 
        else if (temperature > 60) {
            // Trường hợp 2: Chỉ lỗi nhiệt độ
            currentStatus = 'Error_Temp';
            currentReason = 'Sự cố: Nhiệt độ quá cao (>60°C)';
        } 
        else if (noise > 80) {
            // Trường hợp 3: Chỉ lỗi độ ồn
            currentStatus = 'Error_Noise';
            currentReason = 'Cảnh báo: Độ ồn vượt ngưỡng (>80dB)';
        }

        // 3. Cập nhật trạng thái máy tự động
        // Nếu thông số dưới ngưỡng, status sẽ tự động là 'Running'
        await pool.request()
            .input('id', sql.UniqueIdentifier, machine_id)
            .input('s', sql.NVarChar, currentStatus)
            .query("INSERT INTO Machine_Status (MachineID, StatusName) VALUES (@id, @s)");

        // 4. Ghi nhật ký lỗi (Downtime) nếu có sự cố xảy ra
        if (currentStatus !== 'Running') {
            await pool.request()
                .input('id', sql.UniqueIdentifier, machine_id)
                .input('r', sql.NVarChar, currentReason)
                .query("INSERT INTO Downtime_Reasons (MachineID, ReasonDescription) VALUES (@id, @r)");
        }

        // Trả về kết quả cho ESP32 biết để nó yên tâm
        res.json({ status: "success", mode: "auto", current_state: currentStatus });

    } catch (err) { 
        console.error("❌ LỖI SQL GATEWAY:", err.message);
        res.status(500).json({ error: err.message }); 
    }
});

// --- 7. API Admin & Lịch trực ---
app.get('/api/admin/users', async (req, res) => {
    const pool = await poolPromise;
    const result = await pool.request().query("SELECT CAST(u.UserID AS VARCHAR(36)) as id, u.FullName as fullname, u.Username as username, r.RoleName as role FROM Users u JOIN Roles r ON u.RoleID = r.RoleID");
    res.json(result.recordset);
});

app.post('/api/admin/add-week', async (req, res) => {
    if (req.session.user.rank !== 1) return res.status(403).json({status: "denied"});
    try {
        const pool = await poolPromise;
        await pool.request().input('w', sql.NVarChar, req.body.week_range).query("INSERT INTO Defined_Weeks (WeekRange) VALUES (@w)");
        res.json({status: "success"});
    } catch (err) { res.status(500).json({error: err.message}); }
});

app.delete('/api/admin/delete-week', async (req, res) => {
    if (req.session.user.rank !== 1) return res.status(403).json({status: "denied"});
    try {
        const pool = await poolPromise;
        await pool.request().input('w', sql.NVarChar, req.query.week_range).query("DELETE FROM Shift_Schedules WHERE WeekRange = @w");
        await pool.request().input('w', sql.NVarChar, req.query.week_range).query("DELETE FROM Defined_Weeks WHERE WeekRange = @w");
        res.json({status: "success"});
    } catch (err) { res.status(500).json({error: err.message}); }
});

app.post('/api/admin/assign-shift', async (req, res) => {
    const d = req.body;
    try {
        const pool = await poolPromise;
        await pool.request().input('u', sql.UniqueIdentifier, d.user_id).input('w', sql.NVarChar, d.week).input('dy', sql.NVarChar, d.day).input('s', sql.NVarChar, d.slot).input('t', sql.NVarChar, d.task).query("INSERT INTO Shift_Schedules (UserID, WeekRange, DayOfWeek, Slot, Task, StartTime, EndTime) VALUES (@u, @w, @dy, @s, @t, '07:30', '16:45')");
        res.json({status: "success"});
    } catch (err) { res.status(500).json({error: err.message}); }
});

app.delete('/api/admin/delete-shift', async (req, res) => {
    const { user_id, week, day, slot } = req.query;
    try {
        const pool = await poolPromise;
        await pool.request().input('u', sql.UniqueIdentifier, user_id).input('w', sql.NVarChar, week).input('d', sql.NVarChar, day).input('s', sql.NVarChar, slot).query("DELETE FROM Shift_Schedules WHERE UserID=@u AND WeekRange=@w AND DayOfWeek=@d AND Slot=@s");
        res.json({status: "success"});
    } catch (err) { res.status(500).json({error: err.message}); }
});

app.get('/api/system/weeks', async (req, res) => {
    const pool = await poolPromise;
    const result = await pool.request().query("SELECT WeekRange FROM Defined_Weeks ORDER BY WeekRange DESC");
    res.json(result.recordset.map(r => r.WeekRange));
});

app.get('/api/system/all-schedules', async (req, res) => {
    const pool = await poolPromise;
    // ✅ THÊM s.Task as task VÀO ĐÂY ĐỂ LẤY NHIỆM VỤ
    const result = await pool.request().query("SELECT CAST(s.UserID AS VARCHAR(36)) as userId, u.FullName as userName, s.WeekRange as week, s.DayOfWeek as day, s.Slot as slot, s.Task as task FROM Shift_Schedules s JOIN Users u ON s.UserID = u.UserID");
    res.json(result.recordset);
});

app.delete('/api/admin/delete-log/:id', async (req, res) => {
    if (req.session.user.rank !== 1) return res.status(403).json({status: "denied"});
    try {
        const pool = await poolPromise;
        await pool.request().input('id', sql.UniqueIdentifier, req.params.id).query("DELETE FROM Downtime_Reasons WHERE ReasonID = @id");
        res.json({status: "success"});
    } catch (err) { res.status(500).json({error: err.message}); }
});

app.get('/api/system-logs', async (req, res) => {
    try {
        const pool = await poolPromise;
        const result = await pool.request().query("SELECT CAST(d.ReasonID AS VARCHAR(36)) as id, m.MachineName as name, d.ReasonDescription as reason, FORMAT(d.Timestamp, 'dd/MM HH:mm') as time FROM Downtime_Reasons d JOIN Machines m ON d.MachineID = m.MachineID ORDER BY d.Timestamp DESC");
        res.json(result.recordset);
    } catch (err) { res.json([]); }
});

// ✅ API XUẤT NHẬT KÝ VẬN HÀNH RA FILE CSV
app.get('/api/admin/export-logs', async (req, res) => {
    // Chỉ những anh em Rank <= 3 (Admin, Supervisor, Maintenance) mới được xuất báo cáo
    if (!req.session.user || req.session.user.rank > 3) {
        return res.status(403).send("❌ Truy cập bị từ chối: Cần quyền Quản lý hoặc Bảo trì!");
    }

    try {
        const pool = await poolPromise;
        const result = await pool.request().query(`
            SELECT 
                m.MachineName, 
                d.ReasonDescription, 
                FORMAT(d.Timestamp, 'dd/MM/yyyy HH:mm:ss') as Time 
            FROM Downtime_Reasons d 
            JOIN Machines m ON d.MachineID = m.MachineID 
            ORDER BY d.Timestamp DESC
        `);

        // Chuẩn bị chuỗi CSV
        // Ký tự \uFEFF là BOM (Byte Order Mark), giúp Excel đọc được tiếng Việt UTF-8 mà không bị vỡ font
        let csvContent = '\uFEFF'; 
        
        // Thêm Dòng tiêu đề (Header)
        csvContent += "TÊN THIẾT BỊ,NỘI DUNG SỰ CỐ,THỜI GIAN GHI NHẬN\n";

        // Thêm Dữ liệu
        result.recordset.forEach(row => {
            // Bao nội dung sự cố trong dấu ngoặc kép để tránh lỗi nếu trong chuỗi có chứa dấu phẩy
            const safeReason = `"${row.ReasonDescription.replace(/"/g, '""')}"`;
            csvContent += `${row.MachineName},${safeReason},${row.Time}\n`;
        });

        // Gắn Header HTTP để báo cho trình duyệt biết đây là file cần tải về
        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader('Content-Disposition', 'attachment; filename=Nhat_Ky_Bao_Tri_LH_AUTX.csv');
        
        // Trả file về cho client
        res.send(csvContent);

    } catch (err) {
        console.error("❌ LỖI XUẤT CSV:", err.message);
        res.status(500).send("Lỗi hệ thống khi tạo file Excel.");
    }
});

app.post('/api/maintenance/update-status', async (req, res) => {
    try {
        const pool = await poolPromise;
        await pool.request().input('id', sql.UniqueIdentifier, req.body.machine_id).input('s', sql.NVarChar, req.body.next_step).query("INSERT INTO Machine_Status (MachineID, StatusName) VALUES (@id, @s)");
        res.json({status: "success"});
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/admin/invite-codes', async (req, res) => {
    const pool = await poolPromise;
    const result = await pool.request().query("SELECT ic.Code as code, r.RoleName as role FROM InviteCodes ic JOIN Roles r ON ic.RoleID = r.RoleID");
    res.json(result.recordset);
});

// ✅ API XÓA NHÂN SỰ (Đã fix lỗi Method và Khóa ngoại)
app.delete('/api/admin/delete-user/:id', async (req, res) => {
    // Chỉ Admin Rank 1 mới có quyền "trảm"
    if (!req.session.user || req.session.user.rank !== 1) {
        return res.status(403).json({status: "denied"});
    }

    const userId = req.params.id;

    try {
        const pool = await poolPromise;
        
        // Bước 1: Xóa lịch trực của User này trước để tránh lỗi Foreign Key
        await pool.request()
            .input('id', sql.UniqueIdentifier, userId)
            .query("DELETE FROM Shift_Schedules WHERE UserID = @id");

        // Bước 2: Sau khi "dọn dẹp" xong mới xóa User
        const result = await pool.request()
            .input('id', sql.UniqueIdentifier, userId)
            .query("DELETE FROM Users WHERE UserID = @id");

        res.json({status: "success", message: "Đã tiễn nhân sự lên đường!"});
    } catch (err) { 
        console.error("❌ Lỗi xóa nhân sự:", err.message);
        res.status(500).json({error: err.message}); 
    }
});

// --- API THỐNG KÊ TỔNG QUAN (Đã fix lỗi bóng ma 5 phút) ---
app.get('/api/stats/overview', async (req, res) => {
    try {
        const pool = await poolPromise;
        
        // Đếm tổng số máy
        const total = await pool.request().query("SELECT COUNT(*) as count FROM Machines");
        
        // ✅ CHỈ ĐẾM CÁC MÁY MÀ TRẠNG THÁI "MỚI NHẤT" ĐANG LÀ ERROR
        const alerts = await pool.request().query(`
            SELECT COUNT(*) as count 
            FROM Machines m 
            OUTER APPLY (
                SELECT TOP 1 StatusName 
                FROM Machine_Status 
                WHERE MachineID = m.MachineID 
                ORDER BY Timestamp DESC
            ) s
            WHERE s.StatusName LIKE 'Error%'
        `);
            
        res.json({
            total_machines: total.recordset[0].count,
            active_alerts: alerts.recordset[0].count,
            oee_rate: 85.5 
        });
    } catch (err) { res.status(500).json({ total_machines: 0, active_alerts: 0, oee_rate: 0 }); }
});

// --- HỆ THỐNG THÔNG BÁO THỰC TẾ ---
app.post('/api/admin/send-notification', async (req, res) => {
    if (!req.session.user || req.session.user.rank !== 1) return res.status(403).json({status: "denied"});
    const { type, target, message } = req.body;
    try {
        const pool = await poolPromise;
        const request = pool.request();
        request.input('m', sql.NVarChar, message).input('s', sql.NVarChar, req.session.user.fullname);
        if (type === 'role') {
            const roleVal = target === 'all' ? 0 : parseInt(target);
            await request.input('t', sql.Int, roleVal).query("INSERT INTO Notifications (TargetRole, Message, Sender) VALUES (@t, @m, @s)");
        } else {
            await request.input('u', sql.VarChar, target).query("INSERT INTO Notifications (TargetUser, Message, Sender) VALUES (@u, @m, @s)");
        }
        res.json({status: "success"});
    } catch (err) { res.status(500).json({error: err.message}); }
});

app.get('/api/user/notifications', async (req, res) => {
    if (!req.session.user) return res.json([]);
    try {
        const pool = await poolPromise;
        const result = await pool.request()
            .input('u', sql.VarChar, req.session.user.username).input('r', sql.Int, req.session.user.rank)
            .query("SELECT Message as message, Sender as sender, FORMAT(Timestamp, 'HH:mm dd/MM') as time FROM Notifications WHERE TargetRole = @r OR TargetRole = 0 OR TargetUser = @u ORDER BY Timestamp DESC");
        res.json(result.recordset);
    } catch (err) { res.status(500).json([]); }
});

app.get('/logout', (req, res) => { req.session.destroy(); res.redirect('/login'); });
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`🚀 LH_AUTX IOT GATEWAY ONLINE ON PORT ${PORT}`));